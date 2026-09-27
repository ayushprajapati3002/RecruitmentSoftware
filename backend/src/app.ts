import express from 'express';
import cors from 'cors';
import path from 'path';
import candidateRoutes from './routes/candidates';
import searchRoutes from './routes/search';

const app = express();

// Robust CORS allowing all origins, credentials, and preflight requests
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
}));

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/candidates', candidateRoutes);
app.use('/api/search', searchRoutes);

const uploadsStaticDir = path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsStaticDir));

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default app;
