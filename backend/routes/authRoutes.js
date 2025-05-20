import express from 'express';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
} from '../controllers/authController.js';
import { validateRegister, validateLogin } from '../validators/authValidators.js';
import validateRequest from '../middleware/validateRequest.js';

const router = express.Router();

router.post('/register', validateRegister, validateRequest, registerUser);
router.post('/login', validateLogin, validateRequest, loginUser);
router.get('/refresh-token', refreshAccessToken);
router.post('/logout', logoutUser);

export default router;