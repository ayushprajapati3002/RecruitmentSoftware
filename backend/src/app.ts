import express from 'express';
import cors from 'cors';
import path from 'path';
import candidateRoutes from './routes/candidates';
import searchRoutes from './routes/search';

const app = express();

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/candidates', candidateRoutes);
app.use('/api/search', searchRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default app;
