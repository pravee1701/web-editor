import express from 'express';
import {
  listFiles,
  readFileContent,
  writeFileContent,
  createDirectory,
  deleteItem,
  renameItem,
  triggerVfsToHostSync,
  triggerHostToVfsSync
} from '../controllers/workspaceFsController.js';
import protect from '../middleware/authMiddleware.js'; 

const router = express.Router();

router.use(protect); 
router.get('/list', listFiles);
router.get('/read', readFileContent);
router.put('/write', writeFileContent); // Use PUT for updating/creating files
router.post('/mkdir', createDirectory); // Use POST for creating directories
router.delete('/delete', deleteItem);
router.post('/rename', renameItem); // Use POST for actions like rename

router.post('/sync/vfs-to-host', triggerVfsToHostSync);
router.post('/sync/host-to-vfs', triggerHostToVfsSync);


export default router;