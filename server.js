// server.js (UPDATED with robust JSON parsing)
// ------------------
// IMPORTS
// ------------------
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ------------------
// INITIALIZATION
// ------------------
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ------------------
// MIDDLEWARE
// ------------------
app.use(cors());
app.use(express.json());

// Multer setup for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});
const upload = multer({ storage: storage });

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ------------------
// HELPER FUNCTION FOR ERROR HANDLING
// ------------------
const handleGeminiError = (error, res, context) => {
  console.error(`Error ${context}:`, error.message);
  const isRateLimitError = error.status === 429 || (error.toString && error.toString().includes('429'));
  if (isRateLimitError) {
    return res.status(429).json({
      error: `Could not complete request due to high traffic (API rate limit exceeded). Please try again later.`
    });
  }
  res.status(500).json({ error: `Failed to ${context.replace(/ing/g, 'e')}` });
};


// ------------------
// API ENDPOINTS
// ------------------

// Root endpoint for health check
app.get('/', (req, res) => {
  res.send('ADITI Backend is running!');
});

// Customer Registration
app.post('/api/register', async (req, res) => {
  const { fname, lname, gender, age, mobile, email, pan, accountNumber, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newCustomer = await prisma.customer.create({
      data: { fname, lname, gender, age: Number(age), mobile, email, pan, accountNumber, password: hashedPassword },
    });
    res.status(201).json({
      message: 'Customer registered successfully!',
      customer: { id: newCustomer.id, fname: newCustomer.fname, lname: newCustomer.lname, email: newCustomer.email },
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'User with this email, mobile, PAN, or account number already exists.' });
    }
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
});

// Customer Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const customer = await prisma.customer.findUnique({
      where: { email: email },
      include: {
        assessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { messages: true, documents: true }
        },
      },
    });
    if (!customer) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const { password: _, assessments, ...customerData } = customer;
    res.status(200).json({
      message: 'Login successful!',
      customer: customerData,
      latestAssessment: assessments[0] || null,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
});

// Bank User Login
app.post('/api/bank-login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const bankUser = await prisma.bankUser.findUnique({ where: { username } });
    if (!bankUser) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const isMatch = await bcrypt.compare(password, bankUser.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    res.status(200).json({ message: 'Login successful!', user: { username: bankUser.username } });
  } catch (error) {
    console.error('Bank login error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});


// Submit a new assessment
app.post('/api/assessment/submit', async (req, res) => {
  const { customerId, score, answers, breakdown, language } = req.body;
  try {
    let status;
    if (score >= 700) status = 'Approved';
    else if (score >= 500) status = 'Manual Review';
    else status = 'Rejected';

    const newAssessment = await prisma.assessment.create({
      data: { customerId: Number(customerId), score, answers, breakdown, status, language: language || 'en' },
    });

    await prisma.customer.update({
      where: { id: Number(customerId) },
      data: { lastAccessed: new Date() },
    });

    res.status(201).json({ message: 'Assessment submitted successfully!', assessment: newAssessment });
  } catch (error) {
    // ⭐ IMPROVED ERROR LOGGING: This will now show the exact error from the backend.
    console.error('Assessment submission error:', error);
    res.status(500).json({ error: `Failed to submit assessment: ${error.message}` });
  }
});

// Get all assessments for the bank dashboard
app.get('/api/assessments', async (req, res) => {
  try {
    const assessments = await prisma.assessment.findMany({
      include: {
        customer: { select: { fname: true, lname: true } },
        documents: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ assessments });
  } catch (error) {
    console.error('Failed to fetch all assessments:', error);
    res.status(500).json({ error: 'Failed to retrieve assessments.' });
  }
});

// Get a customer's latest assessment
app.get('/api/customer/:id/latest-assessment', async (req, res) => {
  const { id } = req.params;
  try {
    const assessment = await prisma.assessment.findFirst({
      where: { customerId: Number(id) },
      orderBy: { createdAt: 'desc' },
      include: { messages: true, documents: true }
    });
    res.status(200).json({ assessment });
  } catch (error) {
    console.error('Failed to fetch latest assessment:', error);
    res.status(500).json({ error: 'Failed to fetch assessment data.' });
  }
});

// Update assessment status
app.patch('/api/assessments/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const updatedAssessment = await prisma.assessment.update({
      where: { id: Number(id) },
      data: { status },
    });
    res.status(200).json({ message: 'Status updated successfully.', updatedAssessment });
  } catch (error) {
    console.error('Failed to update status:', error);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// Endpoint to send a document request from the bank manager
app.post('/api/assessments/:id/request-docs', async (req, res) => {
  const { id } = req.params;
  const { docTypes } = req.body;
  try {
    const messageText = JSON.stringify({
      type: 'document_request',
      docTypes,
    });

    const newMessage = await prisma.message.create({
      data: {
        assessmentId: Number(id),
        sender: 'Bank Manager',
        text: messageText,
      },
    });

    res.status(201).json({ message: 'Document request sent successfully.', newMessage });
  } catch (error) {
    console.error('Failed to send document request:', error);
    res.status(500).json({ error: 'Failed to send document request.' });
  }
});


// Handle file uploads for an assessment
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    const { assessmentId, docType } = req.body;

    if (!req.file || !assessmentId) {
      return res.status(400).json({ error: 'No file or assessment ID provided.' });
    }

    const { filename, originalname } = req.file;
    const newDocument = await prisma.document.create({
      data: {
        fileName: filename,
        originalName: originalname,
        filePath: `uploads/${filename}`,
        assessmentId: Number(assessmentId),
        docType: docType,
      },
    });

    const messageText = `Customer uploaded a document: "${originalname}" (${docType || 'unspecified type'}).`;
    await prisma.message.create({
      data: {
        assessmentId: Number(assessmentId),
        sender: 'System',
        text: messageText,
      },
    });

    res.status(201).json({ message: 'Document uploaded successfully.', document: newDocument });
  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ error: 'Failed to upload document.' });
  }
});


// Get messages for an assessment
app.get('/api/assessments/:id/messages', async (req, res) => {
  const { id } = req.params;
  try {
    const messages = await prisma.message.findMany({
      where: { assessmentId: Number(id) },
      orderBy: { createdAt: 'asc' },
    });
    res.status(200).json({ messages });
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    res.status(500).json({ error: 'Failed to retrieve messages.' });
  }
});

// Send a new message for an assessment
app.post('/api/assessments/:id/message', async (req, res) => {
  const { id } = req.params;
  const { sender, text } = req.body;
  try {
    const newMessage = await prisma.message.create({
      data: { assessmentId: Number(id), sender, text },
    });
    res.status(201).json({ message: 'Message sent successfully.', newMessage });
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});


// ⭐ Corrected Endpoint: Added robust JSON parsing to handle malformed AI responses.
app.post('/api/generate-questions', async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash'});
    const { coreQuestionIds, language } = req.body;

    const languageMap = { en: 'English', hi: 'Hindi', te: 'Telugu' };
    const targetLanguage = languageMap[language] || 'English';

    const prompt = `
      You are an AI assistant for a financial credit assessment tool.
      Your task is to generate exactly 7 unique, insightful, behavioral finance questions for a user.
      
      IMPORTANT: The user's primary language is ${targetLanguage}. You MUST generate the "question" and the "text" for all options in ${targetLanguage}.

      The questions must NOT be about these specific topics: ${coreQuestionIds.join(', ')}.
      The questions should help understand the user's attitude towards financial planning, risk, and discipline.

      Provide the output in a single, clean JSON array of objects. Each object must have this exact structure (with the text translated to ${targetLanguage}):
      {
        "id": "dynamic_question_N",
        "question": "The text of the question in ${targetLanguage}.",
        "options": [
          { "text": "An option indicating a very responsible behavior in ${targetLanguage}.", "value": 1.0 },
          { "text": "An option indicating a moderately responsible behavior in ${targetLanguage}.", "value": 0.7 },
          { "text": "An option indicating a slightly risky behavior in ${targetLanguage}.", "value": 0.4 },
          { "text": "An option indicating a high-risk or impulsive behavior in ${targetLanguage}.", "value": 0.1 }
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // ⭐ THE FIX: Use a more robust way to clean and parse the JSON string.
    // This looks for the first '{' and last '}' to extract the JSON object.
    const jsonStart = text.indexOf('[');
    const jsonEnd = text.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('AI response did not contain a valid JSON array.');
    }
    const cleanedText = text.substring(jsonStart, jsonEnd + 1);

    const jsonResponse = JSON.parse(cleanedText);
    
    // Ensure IDs are consistent
    jsonResponse.forEach((q, index) => {
        q.id = `dynamic_question_${index + 1}`;
    });

    res.json(jsonResponse);

  } catch (error) {
    handleGeminiError(error, res, 'generating dynamic questions');
  }
});


// ----------------------------------------------------------------
// AI SUMMARY ENDPOINT (REFACTORED AND WITH IMPROVED ERROR HANDLING)
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// AI SUMMARY ENDPOINT (CORRECTED)
// ----------------------------------------------------------------
app.post("/api/summary", async (req, res) => {
  try {
    const { message } = req.body; // Assuming the frontend sends the prompt as 'message'
    if (!message) {
      return res.status(400).json({ error: "Request body must contain a 'message' field" });
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // Construct the correct `contents` object for the API
    const chat = model.startChat({
        history: [], // You can add previous conversation turns here if needed
        generationConfig: {
            temperature: 0.5,
        },
    });

    // Pass the message directly to `sendMessage` which handles the correct JSON structure
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    res.json({
      candidates: [{
        content: {
          parts: [{ text }]
        }
      }]
    });

  } catch (error) {
    handleGeminiError(error, res, 'generating AI summary');
  }
});
// ------------------
// START SERVER
// ------------------
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});