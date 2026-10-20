import { describe, expect, it } from 'vitest';
import { findBoardInLinks, slugFromDomain } from './hiring';

describe('findBoardInLinks', () => {
  it('detects Greenhouse boards', () => {
    const hit = findBoardInLinks(['https://boards.greenhouse.io/stripe/jobs/123']);
    expect(hit).toEqual({ board: 'greenhouse', token: 'stripe' });
  });

  it('detects Lever boards', () => {
    const hit = findBoardInLinks(['https://jobs.lever.co/netflix/abc']);
    expect(hit).toEqual({ board: 'lever', token: 'netflix' });
  });

  it('detects Ashby boards', () => {
    const hit = findBoardInLinks(['https://jobs.ashbyhq.com/linear/xyz']);
    expect(hit).toEqual({ board: 'ashby', token: 'linear' });
  });

  it('returns null when no board links present', () => {
    expect(findBoardInLinks(['https://example.com/careers'])).toBeNull();
  });

  it('lowercases tokens', () => {
    const hit = findBoardInLinks(['https://boards.greenhouse.io/Airbnb']);
    expect(hit?.token).toBe('airbnb');
  });
});

describe('slugFromDomain', () => {
  it('extracts the registrable label', () => {
    expect(slugFromDomain('https://stripe.com/')).toBe('stripe');
    expect(slugFromDomain('https://www.airbnb.com/')).toBe('airbnb');
  });

  it('handles subdomains', () => {
    expect(slugFromDomain('https://careers.notion.so/')).toBe('notion');
  });

  it('returns null for invalid URLs', () => {
    expect(slugFromDomain('not a url')).toBeNull();
  });
});
