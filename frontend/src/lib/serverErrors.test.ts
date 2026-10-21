import { describe, expect, it, vi } from 'vitest';
import { ApiError, errorMessage, RATE_LIMITED_MESSAGE } from '@/api/client';
import { applyServerErrors, describeField, errorSummary } from './serverErrors';

const validation = (details: { field: string; message: string }[]) =>
  new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', details);

describe('applyServerErrors', () => {
  it('sets known fields, folds "(root)" and unmapped dotted paths into one form-level message', () => {
    const setError = vi.fn();
    applyServerErrors(
      validation([
        { field: 'subject', message: 'Subject must be at least 3 characters' },
        { field: 'attachments.0.size', message: 'Too large' },
        { field: '(root)', message: 'Body must be an object' },
      ]),
      setError,
      ['subject', 'description'],
    );

    expect(setError).toHaveBeenCalledWith('subject', { type: 'server', message: 'Subject must be at least 3 characters' }, { shouldFocus: true });
    expect(setError).toHaveBeenCalledWith('root.server', { type: 'server', message: 'Attachment 1 size: Too large Body must be an object' });
    expect(setError).toHaveBeenCalledTimes(2);
  });

  it('maps dotted paths that are registered as fields', () => {
    const setError = vi.fn();
    applyServerErrors(validation([{ field: 'address.city', message: 'Required' }]), setError, ['address.city' as never]);
    expect(setError).toHaveBeenCalledWith('address.city', expect.objectContaining({ message: 'Required' }), { shouldFocus: true });
    expect(setError).toHaveBeenCalledTimes(1); // field message is enough; no generic root message
  });

  it('falls back to a single root message when there are no details', () => {
    const setError = vi.fn();
    applyServerErrors(new ApiError(500, 'INTERNAL', 'Database unavailable'), setError, ['subject']);
    expect(setError).toHaveBeenCalledWith('root.server', { type: 'server', message: 'Database unavailable' });
  });

  it('shows the friendly message for 429 RATE_LIMITED', () => {
    const setError = vi.fn();
    applyServerErrors(new ApiError(429, 'RATE_LIMITED', 'Too many AI requests. Please wait a moment.'), setError, ['email']);
    expect(setError).toHaveBeenCalledWith('root.server', { type: 'server', message: RATE_LIMITED_MESSAGE });
  });
});

describe('error messages', () => {
  it('uses one friendly wording for rate limiting, whatever the server says', () => {
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', 'Slow down'))).toBe('Too many requests, try again shortly.');
    expect(errorMessage(new ApiError(429, 'INTERNAL', 'proxy says no'))).toBe('Too many requests, try again shortly.');
  });

  it('summarises field details for forms without react-hook-form', () => {
    expect(errorSummary(validation([{ field: 'body', message: 'Body is required' }]))).toBe('Body is required');
  });

  it('describes attachment paths in plain words', () => {
    expect(describeField('attachments.2.name')).toBe('Attachment 3 name');
    expect(describeField('bookId')).toBe('bookId');
  });
});
