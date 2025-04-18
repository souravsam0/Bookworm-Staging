import express from "express";
import cloudinary from "../lib/cloudinary.js";
import Book from "../models/Book.js";
import protectRoute from '../src/middleware/auth.middleware.js';
import User from "../models/User.js";
import { Expo } from 'expo-server-sdk';

const router = express.Router();

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN
});

router.post("/", protectRoute, async (req, res) => {
    try {
        const { title, caption, image, rating } = req.body;

        if (!image || !title || !caption || !rating) {
            return res.status(400).json({ message: "Please provide all fields" });
        }

        // Upload image to Cloudinary
        const uploadResponse = await cloudinary.uploader.upload(image);
        const imageUrl = uploadResponse.secure_url;

        // Create and save new book
        const newBook = new Book({
            title,
            caption,
            image: imageUrl,
            rating,
            user: req.user._id
        });

        await newBook.save();

        // Notification logic
        try {
            // Get all users except the creator
            const users = await User.find({ _id: { $ne: req.user._id } })
                .select('expoPushToken username');

            // Prepare notifications
            const messages = [];
            users.forEach(user => {
                if (Expo.isExpoPushToken(user.expoPushToken)) {
                    messages.push({
                        to: user.expoPushToken,
                        sound: 'default',
                        title: 'New Book Recommendation! 📚',
                        body: `${req.user.username} added "${title}"`,
                        data: { bookId: newBook._id.toString() }
                    });
                }
            });

            // Send in chunks
            const chunks = expo.chunkPushNotifications(messages);
            for (const chunk of chunks) {
                await expo.sendPushNotificationsAsync(chunk);
            }
        } catch (notificationError) {
            console.error("Notification error:", notificationError);
        }

        res.status(201).json(newBook);

    } catch (error) {
        console.log("Error creating book", error);
        res.status(500).json({ message: error.message });
    }
});

// Rest of your existing routes
router.get("/", protectRoute, async (req, res) => {
    try {
        const page = req.query.page || 1;
        const limit = parseInt(req.query.limit) || 2; 
        const skip = (page - 1) * limit;

        const books = await Book.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("user", "username profileImage");

        const totalBooks = await Book.countDocuments();

        res.send({
            books,
            currentPage: page,
            totalBooks: totalBooks,
            totalPages: Math.ceil(totalBooks / limit)
        });
    } catch (error) {
        console.log("Error in getting books", error);
        res.status(500).json({ message: "Can't fetch books" });
    }
});

router.get("/user", protectRoute, async (req, res) => {
    try {
        const books = await Book.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(books);
    } catch (error) {
        console.error("Get user books error:", error.message);
        res.status(500).json({ message: "Server error" });
    }
});

router.delete("/:id", protectRoute, async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: "Book not found!" });

        if (book.user.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (book.image && book.image.includes("cloudinary")) {
            try {
                const publicId = book.image.split("/").pop().split(".")[0];
                await cloudinary.uploader.destroy(publicId);
            } catch (deleteError) {
                console.log("Error deleting image from cloudinary", deleteError);
            }
        }

        await book.deleteOne();
        res.json({ message: "Book deleted Successfully" });
    } catch (error) {
        console.log("Error deleting book", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

export default router;