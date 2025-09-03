import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import App from './App';

describe('App', () => {
  it('muestra título', () => {
    render(<App />);
    expect(screen.getByText(/Olive Tracking/i)).toBeInTheDocument();
  });
});
