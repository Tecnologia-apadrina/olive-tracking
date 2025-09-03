import { render, screen } from '@testing-library/react';
import App from './App';
import '@testing-library/jest-dom';

test('muestra título', () => {
  render(<App />);
  expect(screen.getByText(/Olive Tracking/i)).toBeInTheDocument();
});
