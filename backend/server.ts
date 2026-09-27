import dotenv from 'dotenv';
dotenv.config();

import app from './src/app';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
