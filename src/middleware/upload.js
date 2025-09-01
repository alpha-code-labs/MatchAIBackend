const multer = require('multer');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  
  const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp'
  ];
  
  // Allow profile pictures (single and multi-photo format)
  if (file.fieldname === 'profilePicture' || file.fieldname.startsWith('profilePicture_')) {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`), false);
    }
  } else {
    cb(new Error(`Unexpected field: ${file.fieldname}. Only profile pictures are allowed.`), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default (increased for better quality)
    files: 5 // Maximum 5 files
  },
  fileFilter: fileFilter
});

// Updated middleware for handling multiple dynamic file fields
const uploadFields = (req, res, next) => {
  
  // Use multer's any() method to handle dynamic field names like profilePicture_0, profilePicture_1, etc.
  const uploadAny = upload.any();
  
  uploadAny(req, res, (err) => {
    if (err) {
      console.error('❌ Upload middleware error:', err.message);
      console.error('❌ Error code:', err.code);
      console.error('❌ Field:', err.field);
      return next(err);
    }
    
    // Log uploaded files for debugging
    if (req.files && req.files.length > 0) {
      // Reorganize files by fieldname for easier access in controllers
      const filesByField = {};
      req.files.forEach(file => {
        if (!filesByField[file.fieldname]) {
          filesByField[file.fieldname] = [];
        }
        filesByField[file.fieldname].push(file);
      });
      
      // Replace req.files with organized structure
      req.files = filesByField;
    } else {
      req.files = {};
    }
    
    next();
  });
};

// Error handler middleware
const handleUploadError = (error, req, res, next) => {
  console.error('❌ Upload error handler triggered:', error.message);
  
  if (error instanceof multer.MulterError) {
    let message = 'File upload error';
    let statusCode = 400;
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = `File too large. Maximum size is ${parseInt(process.env.MAX_FILE_SIZE) || 10}MB per file.`;
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files uploaded. Maximum 5 photos allowed.';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = `Unexpected file field: ${error.field}. Only profile pictures are allowed.`;
        break;
      case 'LIMIT_PART_COUNT':
        message = 'Too many form parts.';
        break;
      case 'LIMIT_FIELD_KEY':
        message = 'Field name too long.';
        break;
      case 'LIMIT_FIELD_VALUE':
        message = 'Field value too long.';
        break;
      case 'LIMIT_FIELD_COUNT':
        message = 'Too many fields.';
        break;
      default:
        message = `Upload error: ${error.message}`;
    }
    
    return res.status(statusCode).json({
      status: 'error',
      message: message,
      code: error.code
    });
  }
  
  // Handle file type errors
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
  
  // Handle unexpected field errors
  if (error.message.includes('Unexpected field')) {
    return res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
  
  // Pass other errors to global error handler
  next(error);
};

module.exports = {
  uploadFields,
  handleUploadError
};