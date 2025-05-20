import asyncHandler from 'express-async-handler';
import File from '../models/fileModel.js';

// @desc    Create a new file
// @route   POST /api/files
// @access  Private
export const createFile = asyncHandler(async (req, res) => {
  const { name, type, parentId } = req.body;

  if (!['file', 'folder'].includes(type)) {
    res.status(400);
    throw new Error('Invalid type. Must be "file" or "folder".');
  }

  const file = await File.create({
    name,
    type,
    parentId: parentId || null,
    userId: req.user.id,
  });

  res.status(201).json(file);
});

// Helper function to build a hierarchical file tree
const buildFileTree = (files, parentId = null) => {
  return files
    .filter((file) => String(file.parentId) === String(parentId)) // Filter files by parentId
    .map((file) => ({
      ...file.toObject(), // Convert Mongoose document to plain object
      children: buildFileTree(files, file._id), // Recursively build children
    }));
};

// @desc    Get all files for a user in a hierarchical structure
// @route   GET /api/files
// @access  Private
export const getFiles = asyncHandler(async (req, res) => {
  const files = await File.find({ userId: req.user.id }); // Fetch all files for the user
  const fileTree = buildFileTree(files); // Build the hierarchical structure
  res.json(fileTree); // Return the file tree
});

// @desc    Move a file or folder
// @route   PUT /api/files/move
// @access  Private
export const moveFile = asyncHandler(async (req, res) => {
  const { draggedId, targetId } = req.body;

  const file = await File.findById(draggedId);
  if (!file) {
    res.status(404);
    throw new Error('File not found');
  }

  if (file.userId.toString() !== req.user.id) {
    res.status(401);
    throw new Error('Not authorized');
  }

  file.parentId = targetId || null;
  await file.save();
  res.json(file);
});

// @desc    Update a file
// @route   PUT /api/files/:id
// @access  Private
export const updateFile = asyncHandler(async (req, res) => {
  const { name, content } = req.body;

  const file = await File.findById(req.params.id);

  if (!file) {
    res.status(404);
    throw new Error('File not found');
  }

  if (file.userId.toString() !== req.user.id) {
    res.status(401);
    throw new Error('Not authorized');
  }

  file.name = name || file.name;
  file.content = content || file.content;

  const updatedFile = await file.save();
  res.json(updatedFile);
});

// @desc    Delete a file
// @route   DELETE /api/files/:id
// @access  Private
export const deleteFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);

  if (!file) {
    res.status(404);
    throw new Error('File not found');
  }

  if (file.userId.toString() !== req.user.id) {
    res.status(401);
    throw new Error('Not authorized');
  }

  await file.deleteOne(); // Use deleteOne instead of remove
  res.json({ message: 'File removed' });
});