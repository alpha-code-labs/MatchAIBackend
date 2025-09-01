const { BlobServiceClient } = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

class AzureStorageService {
  constructor() {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      `DefaultEndpointsProtocol=https;AccountName=${process.env.AZURE_STORAGE_ACCOUNT_NAME};AccountKey=${process.env.AZURE_STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net`
    );
    this.containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  }

  async uploadImage(imageBuffer, originalName, userId, photoIndex = null) {
    try {
      // Generate unique filename with photo index for multi-photo support
      const fileExtension = originalName.split('.').pop() || 'jpg';
      const photoName = photoIndex !== null ? `photo-${photoIndex}` : `profile-${uuidv4()}`;
      const fileName = `users/${userId}/${photoName}.${fileExtension}`;
            
      // Optimize image using Sharp
      const optimizedBuffer = await sharp(imageBuffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Get container client
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      
      // Create container if it doesn't exist
      await containerClient.createIfNotExists({
        access: 'blob' // Public read access for images
      });

      // Upload blob
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);
      await blockBlobClient.upload(optimizedBuffer, optimizedBuffer.length, {
        blobHTTPHeaders: {
          blobContentType: 'image/jpeg'
        }
      });
      // Return the public URL
      return blockBlobClient.url;
    } catch (error) {
      console.error('❌ Azure upload error:', error);
      throw new Error(`Failed to upload image to Azure: ${error.message}`);
    }
  }

  async uploadMultipleImages(files, userId, existingPhotos = []) {
    try {
      const uploadedPhotos = [];

      // Process each file
      for (const [fieldName, fileArray] of Object.entries(files)) {
        const file = fileArray[0]; // multer puts files in arrays
        
        // Extract photo index from field name (e.g., "profilePicture_2" -> 2)
        const indexMatch = fieldName.match(/profilePicture_(\d+)/);
        if (!indexMatch) continue;
        
        const photoIndex = parseInt(indexMatch[1]);

        // Upload to Azure
        const imageUrl = await this.uploadImage(file.buffer, file.originalname, userId, photoIndex);
        
        uploadedPhotos.push({
          index: photoIndex,
          url: imageUrl,
          isNew: true
        });
      }

      return uploadedPhotos;
    } catch (error) {
      console.error('❌ Multi-photo upload error:', error);
      throw new Error(`Failed to upload multiple images: ${error.message}`);
    }
  }

  async uploadImageFromUrl(imageUrl, userId, photoIndex = null) {
    try {      
      // Fetch image from URL (Google profile pic)
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      const imageBuffer = Buffer.from(await response.arrayBuffer());
      // Upload to Azure
      return await this.uploadImage(imageBuffer, 'profile.jpg', userId, photoIndex);
    } catch (error) {
      console.error('❌ URL download error:', error);
      throw new Error(`Failed to download and upload image: ${error.message}`);
    }
  }

  async deleteImage(imageUrl) {
    try {
      if (!imageUrl) return;
      
      // Extract blob name from URL
      const url = new URL(imageUrl);
      const blobName = url.pathname.split('/').slice(2).join('/'); // Remove container name
      
      
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      
      await blockBlobClient.deleteIfExists();
    } catch (error) {
      console.error('❌ Azure delete error:', error);
      // Don't throw error for delete failures - just log
    }
  }

  async deleteMultipleImages(imageUrls) {
    try {
      if (!imageUrls || imageUrls.length === 0) return;
      
      
      // Delete all images in parallel
      const deletePromises = imageUrls.map(url => this.deleteImage(url));
      await Promise.allSettled(deletePromises);
      
    } catch (error) {
      console.error('❌ Multi-photo deletion error:', error);
      // Don't throw error for delete failures - just log
    }
  }

  async deleteUserPhotos(userId) {
    try {
      
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const prefix = `users/${userId}/`;
      
      // List all blobs with the user prefix
      const blobs = containerClient.listBlobsFlat({ prefix });
      
      // Delete each blob
      for await (const blob of blobs) {
        const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
        await blockBlobClient.deleteIfExists();
      }
      
    } catch (error) {
      console.error('❌ Error deleting user photos:', error);
      // Don't throw error for delete failures - just log
    }
  }
}

module.exports = new AzureStorageService();