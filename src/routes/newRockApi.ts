import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({ message: 'GET - Welcome to the New Rock API!' });
});

router.post('/', (req, res) => {
  res.json({ message: 'POST - Welcome to the New Rock API!' });
});

export { router };