const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { logActivity } = require('../services/activityService');
const ChatConversation = require('../models/ChatConversation');

// Predefined responses for common questions
const responses = {
    greetings: [
        "Hello! How can I help you today?",
        "Hi there! What can I do for you?",
        "Welcome! How may I assist you?"
    ],
    help: {
        registration: {
            text: "To register, click on the 'Register' button and fill out the form with your details. You'll need to provide your name, email, and create a password.",
            links: [{ text: "Register Now", url: "/register", type: "action" }]
        },
        login: {
            text: "To log in, click the 'Login' button and enter your email/username and password. You can also use Google Sign-In if you prefer.",
            links: [{ text: "Login Now", url: "/", type: "action" }]
        },
        teams: {
            text: "Teams are groups of users working together on projects. You can create a team, join existing teams, or manage team members through the Teams section.",
            links: [{ text: "Go to Teams", url: "/teams", type: "action" }]
        },
        projects: {
            text: "Projects help organize your work. You can create projects, assign tasks, and track progress. Each project can have multiple tasks and team members.",
            links: [{ text: "View Projects", url: "/projects", type: "action" }]
        },
        tasks: {
            text: "Tasks are individual work items within a project. You can create tasks, assign them to team members, set deadlines, and update their status.",
            links: [{ text: "View Tasks", url: "/tasks", type: "action" }]
        },
        profile: {
            text: "You can update your profile by clicking on your profile picture/name in the top right corner and selecting 'Profile'. Here you can update your personal information and preferences.",
            links: [{ text: "Update Profile", url: "/profile", type: "action" }]
        },
        kanban: {
            text: "The Kanban board helps you visualize your workflow. You can drag and drop tasks between different status columns (To Do, In Progress, Done) to track progress.",
            links: [{ text: "Open Kanban Board", url: "/kanban", type: "action" }]
        },
        query: {
            text: "The Query board allows you to search and filter tasks based on various criteria like status, assignee, due date, and more.",
            links: [{ text: "Open Query Board", url: "/query", type: "action" }]
        },
        userStories: {
            text: "User stories help capture requirements from a user's perspective. You can create user stories, link them to tasks, and track their implementation status.",
            links: [{ text: "View User Stories", url: "/user-stories", type: "action" }]
        },
        dashboard: {
            text: "The dashboard is your central hub for managing teams, projects, and tasks. You can access all your important information and tools from here.",
            links: [{ text: "Go to Dashboard", url: "/dashboard", type: "action" }]
        },
        landing: {
            text: "The landing page provides an overview of TeamLabs features and benefits. You can learn more about our project management platform here.",
            links: [{ text: "Visit Landing Page", url: "/", type: "action" }]
        }
    },
    error: "I'm not sure I understand. Could you please rephrase your question?",
    fallback: {
        text: "I'm still learning about TeamLabs. For specific questions, please contact our support team.",
        links: [{ text: "Contact Support", url: "/support", type: "action" }]
    },
    goodbye: [
        "Goodbye! Have a great day!",
        "See you later! Feel free to come back if you have more questions.",
        "Take care! Don't hesitate to ask if you need help again."
    ]
};

// Helper Functions
const getRandomResponse = (responseArray) => {
    return responseArray[Math.floor(Math.random() * responseArray.length)];
};

const processMessage = (message) => {
    const lowerMessage = message.toLowerCase();

    // Check for greetings
    if (lowerMessage.match(/^(hi|hello|hey|greetings)/)) {
        return {
            text: getRandomResponse(responses.greetings),
            links: [
                { text: "Login", url: "/", type: "action" },
                { text: "Register", url: "/register", type: "action" },
                { text: "Learn More", url: "/", type: "action" }
            ]
        };
    }

    // Check for goodbyes
    if (lowerMessage.match(/^(bye|goodbye|see you|farewell)/)) {
        return { text: getRandomResponse(responses.goodbye) };
    }

    // Check for help topics
    if (lowerMessage.includes('how to') || lowerMessage.includes('how do i')) {
        if (lowerMessage.includes('register') || lowerMessage.includes('sign up')) {
            return responses.help.registration;
        }
        if (lowerMessage.includes('login') || lowerMessage.includes('sign in')) {
            return responses.help.login;
        }
        if (lowerMessage.includes('team')) {
            return responses.help.teams;
        }
        if (lowerMessage.includes('project')) {
            return responses.help.projects;
        }
        if (lowerMessage.includes('task')) {
            return responses.help.tasks;
        }
        if (lowerMessage.includes('profile')) {
            return responses.help.profile;
        }
        if (lowerMessage.includes('kanban')) {
            return responses.help.kanban;
        }
        if (lowerMessage.includes('query')) {
            return responses.help.query;
        }
        if (lowerMessage.includes('user story') || lowerMessage.includes('user stories')) {
            return responses.help.userStories;
        }
    }

    // Check for specific questions about features
    if (lowerMessage.includes('what is') || lowerMessage.includes('what are')) {
        if (lowerMessage.includes('team')) {
            return responses.help.teams;
        }
        if (lowerMessage.includes('project')) {
            return responses.help.projects;
        }
        if (lowerMessage.includes('task')) {
            return responses.help.tasks;
        }
        if (lowerMessage.includes('kanban')) {
            return responses.help.kanban;
        }
        if (lowerMessage.includes('query')) {
            return responses.help.query;
        }
        if (lowerMessage.includes('user story') || lowerMessage.includes('user stories')) {
            return responses.help.userStories;
        }
        if (lowerMessage.includes('dashboard')) {
            return responses.help.dashboard;
        }
        if (lowerMessage.includes('landing page')) {
            return responses.help.landing;
        }
    }

    // If no specific match is found
    return responses.fallback;
};

// Function to get or create an active conversation
const getActiveConversation = async (userId) => {
    let conversation = await ChatConversation.findOne({
        user: userId,
        status: 'active'
    });

    if (!conversation) {
        conversation = await ChatConversation.create({
            user: userId,
            messages: []
        });
    }

    return conversation;
};

// Route Handlers
const handleChatMessage = async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ message: 'Message is required' });
        }

        // Process the message and get a response
        const response = processMessage(message);

        // If user is authenticated, store the conversation
        if (req.user) {
            const conversation = await getActiveConversation(req.user._id);
            
            // Add messages to conversation
            conversation.messages.push(
                { type: 'user', content: message },
                { type: 'bot', content: response }
            );
            
            conversation.lastInteraction = new Date();
            await conversation.save();

            // Log the interaction
            await logActivity(
                req.user._id,
                'chatbot_interaction',
                'info',
                `User asked: ${message}`,
                req,
                { message, response }
            );
        }

        res.json({ response });
    } catch (error) {
        console.error('Chatbot error:', error);
        res.status(500).json({ message: 'Error processing message' });
    }
};

const getConversationHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const conversations = await ChatConversation.find({ user: req.user._id })
            .sort({ lastInteraction: -1 })
            .skip(skip)
            .limit(limit)
            .select('messages lastInteraction status');

        const total = await ChatConversation.countDocuments({ user: req.user._id });

        res.json({
            conversations,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching conversation history:', error);
        res.status(500).json({ message: 'Error fetching conversation history' });
    }
};

// Routes
router.post('/greet', handleChatMessage);
router.post('/', protect, handleChatMessage);
router.get('/history', protect, getConversationHistory);

module.exports = router; 