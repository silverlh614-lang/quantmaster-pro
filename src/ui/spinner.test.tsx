// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from './spinner';
import { Button } from './button';

describe('Spinner', () => {
  it('renders ring spinner by default', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('span');
    expect(spinner?.className).toContain('animate-spin');
  });

  it('renders dot spinner with 3 bouncing dots', () => {
    const { container } = render(<Spinner variant="dots" />);
    const dots = container.querySelectorAll('.animate-bounce');
    expect(dots.length).toBe(3);
  });
});

describe('Button loading spinner options', () => {
  it('shows loading text and custom spinner variant', () => {
    const { getByText, container } = render(
      <Button loading loadingText="로딩 중" spinnerVariant="dots">
        저장
      </Button>
    );
    expect(getByText('로딩 중')).toBeTruthy();
    expect(container.querySelectorAll('.animate-bounce').length).toBe(3);
  });
});
