const express = require('express');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // 🔹 New import for unique IDs

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 5000;

// Use CORS middleware
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Initialize Prisma Client
const prisma = new PrismaClient();

// 🔹 Updated Multer configuration for unique filenames
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Save files in the 'uploads' directory
  },
  filename: function (req, file, cb) {
    // 🔹 Generate a unique filename to prevent conflicts
    const uniqueSuffix = Date.now() + '-' + uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root endpoint for testing
app.get('/', (req, res) => {
  res.send('ADITI Backend is running!');
});

// Customer Registration Endpoint
app.post('/api/register', async (req, res) => {
  const {
    fname,
    lname,
    gender,
    age,
    mobile,
    email,
    pan,
    accountNumber,
    password,
  } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const newCustomer = await prisma.customer.create({
      data: {
        fname,
        lname,
        gender,
        age: Number(age),
        mobile,
        email,
        pan,
        accountNumber,
        password: hashedPassword,
      },
    });

    res.status(201).json({
      message: 'Customer registered successfully!',
      customer: {
        id: newCustomer.id,
        fname: newCustomer.fname,
        lname: newCustomer.lname,
        email: newCustomer.email,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({
        error: 'User with this email, mobile, PAN, or account number already exists.',
      });
    }
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
});

// Customer Login Endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const customer = await prisma.customer.findUnique({
      where: {
        email: email,
      },
      include: {
        assessments: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          include: {
            messages: true,
            documents: true,
          }
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

// 🔹 Endpoint: Submit a new assessment
app.post('/api/assessment/submit', async (req, res) => {
  const { customerId, score, answers, breakdown } = req.body;
  try {
    let status;
    if (score >= 750) {
      status = 'Approved';
    } else if (score >= 600) {
      status = 'Manual Review';
    } else {
      status = 'Rejected';
    }

    const newAssessment = await prisma.assessment.create({
      data: {
        customerId: Number(customerId),
        score,
        answers,
        breakdown,
        status,
      },
    });

    await prisma.customer.update({
        where: { id: Number(customerId) },
        data: { lastAccessed: new Date() },
    });

    res.status(201).json({ 
      message: 'Assessment submitted successfully!', 
      assessment: newAssessment 
    });
  } catch (error) {
    console.error('Assessment submission error:', error);
    res.status(500).json({ error: 'Failed to submit assessment.' });
  }
});

// 🔹 Endpoint: Get a customer's latest assessment
app.get('/api/customer/:id/latest-assessment', async (req, res) => {
  const { id } = req.params;
  try {
    const assessment = await prisma.assessment.findFirst({
      where: { customerId: Number(id) },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: true,
        documents: true,
      }
    });
    res.status(200).json({ assessment });
  } catch (error) {
    console.error('Failed to fetch latest assessment:', error);
    res.status(500).json({ error: 'Failed to fetch assessment data.' });
  }
});

// 🔹 Endpoint: Get all assessments for the bank dashboard
app.get('/api/assessments', async (req, res) => {
    try {
        const assessments = await prisma.assessment.findMany({
            include: {
                customer: {
                    select: {
                        fname: true,
                        lname: true,
                    },
                },
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

// 🔹 Endpoint: Bank User Login
app.post('/api/bank-login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const bankUser = await prisma.bankUser.findUnique({
            where: { username },
        });

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


// 🔹 Endpoint: Handle file uploads for an assessment
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file || !req.body.assessmentId) {
      return res.status(400).json({ error: 'No file or assessment ID provided.' });
    }

    const { filename, originalname } = req.file; // 🔹 filename is now the unique filename
    const { assessmentId } = req.body;

    const newDocument = await prisma.document.create({
      data: {
        fileName: filename, // 🔹 Store the unique filename here
        originalName: originalname, // 🔹 Store the original name here
        filePath: `uploads/${filename}`, // 🔹 Use the unique filename for the file path
        assessmentId: Number(assessmentId),
      },
    });

    res.status(201).json({ message: 'Document uploaded successfully.', document: newDocument });
  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ error: 'Failed to upload document.' });
  }
});

// 🔹 Endpoint: Get messages for an assessment
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

// 🔹 Endpoint: Send a new message for an assessment
app.post('/api/assessments/:id/message', async (req, res) => {
  const { id } = req.params;
  const { sender, text } = req.body;
  try {
    const newMessage = await prisma.message.create({
      data: {
        assessmentId: Number(id),
        sender,
        text,
      },
    });
    res.status(201).json({ message: 'Message sent successfully.', newMessage });
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// 🔹 Endpoint: Update assessment status (for bank manager)
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


// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});