import asyncHandler from 'express-async-handler';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';



export const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.accessToken ||
    req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const decodedToken = jwt.verify(
      token,
      process.env.JWT_SECRET
    );
    const user = await User.findById(decodedToken?.id).select(
      "-password "
    )

    if (!user) {
      return res.status(401).json({ message: 'Invalid access token' });
    }

    // if (!user.isEmailVerified && req.path !== '/verify-email') {
    //   return next(new ApiError(401, 'Please verify your email first'));
    // }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
});
export default protect;