import express from 'express';
import { 
    getUserVfsProjects, 
    createNewVfsProject,
    getAvailableTemplates,
    createUserTemplate,
    shareVfsProject, 
    getSharedVfsProjects,   
    unshareVfsProject       
} from '../controllers/vfsController.js';
import protectRoute from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/templates', protectRoute, getAvailableTemplates); 

router.use(protectRoute); 

router.get('/projects', getUserVfsProjects);
router.post('/projects', createNewVfsProject);

router.get('/projects/shared-with-me', getSharedVfsProjects); 
router.post('/projects/:projectId/share', shareVfsProject);   
router.delete('/projects/:projectId/share/:targetUserId', unshareVfsProject); 

router.post('/user-templates', createUserTemplate);

export default router;