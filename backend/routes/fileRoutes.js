import express from 'express';
import {
  createFile,
  getFiles,
  updateFile,
  deleteFile,
  moveFile,
} from '../controllers/fileController.js';
import protect from '../middleware/authMiddleware.js';

const router = express.Router();

router.put('/move', protect, moveFile); 

router.route('/')
  .post(protect, createFile) // Create a new file
  .get(protect, getFiles);   // Get all files for a user

router.route('/:id')
  .put(protect, updateFile)  // Update a file
  .delete(protect, deleteFile); // Delete a file

export default router;