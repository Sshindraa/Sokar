import { describe, it, expect } from 'vitest';
import { buildRedisUrls } from '../client';

describe('buildRedisUrls', () => {
  it('prod: redis://host:6379 → session DB 0, cache DB 1, queue DB 2', () => {
    const urls = buildRedisUrls('redis://127.0.0.1:6379');
    expect(urls.session).toBe('redis://127.0.0.1:6379/0');
    expect(urls.cache).toBe('redis://127.0.0.1:6379/1');
    expect(urls.queue).toBe('redis://127.0.0.1:6379/2');
  });

  it('staging: redis://host:6379/3 → session DB 3, cache DB 4, queue DB 5', () => {
    const urls = buildRedisUrls('redis://localhost:6379/3');
    expect(urls.session).toBe('redis://localhost:6379/3');
    expect(urls.cache).toBe('redis://localhost:6379/4');
    expect(urls.queue).toBe('redis://localhost:6379/5');
  });

  it('staging with auth: redis://user:pass@host:6379/3 → preserves auth', () => {
    const urls = buildRedisUrls('redis://user:secret@localhost:6379/3');
    expect(urls.session).toBe('redis://user:secret@localhost:6379/3');
    expect(urls.queue).toBe('redis://user:secret@localhost:6379/5');
  });

  it('rediss:// (TLS) protocol preserved', () => {
    const urls = buildRedisUrls('rediss://redis.example.com:6380/5');
    expect(urls.session).toBe('rediss://redis.example.com:6380/5');
    expect(urls.cache).toBe('rediss://redis.example.com:6380/6');
    expect(urls.queue).toBe('rediss://redis.example.com:6380/7');
  });

  it('path "/" treated as DB 0', () => {
    const urls = buildRedisUrls('redis://127.0.0.1:6379/');
    expect(urls.session).toBe('redis://127.0.0.1:6379/0');
    expect(urls.queue).toBe('redis://127.0.0.1:6379/2');
  });

  it('non-numeric path defaults to DB 0', () => {
    const urls = buildRedisUrls('redis://127.0.0.1:6379/abc');
    expect(urls.session).toBe('redis://127.0.0.1:6379/0');
    expect(urls.queue).toBe('redis://127.0.0.1:6379/2');
  });

  it('regression: staging no longer shares DB 2 with prod', () => {
    const prod = buildRedisUrls('redis://127.0.0.1:6379');
    const staging = buildRedisUrls('redis://localhost:6379/3');
    expect(prod.queue).not.toBe(staging.queue);
    expect(prod.queue).toBe('redis://127.0.0.1:6379/2');
    expect(staging.queue).toBe('redis://localhost:6379/5');
  });
});
