import express from "express";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
// You'll need to install a package for OTP generation
// npm install otp-generator
import otpGenerator from "otp-generator";

const router = express.Router();

// In-memory OTP storage (in production, consider using Redis or a database)
const otpStore = {};

const generateToken = (userId) => {
    return jwt.sign({userId}, process.env.JWT_SECRET, { expiresIn: "15d"});
}

// Request OTP endpoint
router.post("/request-otp", async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ message: "Phone number is required" });
        }

        // Generate a 6-digit OTP
        const otp = otpGenerator.generate(6, { 
            digits: true, 
            alphabets: false, 
            upperCase: false, 
            specialChars: false 
        });

        // Store OTP with expiry (5 minutes)
        otpStore[phone] = {
            otp,
            expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes in milliseconds
        };

        // In a real application, you would send the OTP via SMS here
        console.log(`OTP for ${phone}: ${otp}`);

        // Check if user exists
        let user = await User.findOne({ phoneNumber: phone });

        res.status(200).json({ 
            message: "OTP sent successfully",
            isNewUser: !user
        });

    } catch (error) {
        console.log("Error in request-otp route", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Verify OTP endpoint
router.post("/verify-otp", async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({ message: "Phone number and OTP are required" });
        }

        // Check if OTP exists and is valid
        const otpData = otpStore[phone];
        if (!otpData || otpData.otp !== otp) {
            return res.status(400).json({ message: "Invalid OTP" });
        }

        // Check if OTP is expired
        if (Date.now() > otpData.expiresAt) {
            delete otpStore[phone]; // Clear expired OTP
            return res.status(400).json({ message: "OTP has expired" });
        }

        // Clear OTP after successful verification
        delete otpStore[phone];

        // Find or create user
        let user = await User.findOne({ phoneNumber: phone });
        
        if (!user) {
            // Create a new user with phone number
            const username = `user_${Date.now().toString().slice(-6)}`;
            const profileImage = `https://api.dicebear.com/9.x/personas/svg?seed=${username}`;
            
            user = new User({
                phoneNumber: phone,
                username,
                profileImage,
                // Generate a random password for the user
                password: Math.random().toString(36).slice(-8),
            });
            
            await user.save();
        }

        // Generate token
        const token = generateToken(user._id);

        res.status(200).json({
            token,
            user: {
                id: user._id,
                username: user.username,
                phoneNumber: user.phoneNumber,
                profileImage: user.profileImage,
                createdAt: user.createdAt,
            }
        });

    } catch (error) {
        console.log("Error in verify-otp route", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Keep the existing logout route if needed

export default router;