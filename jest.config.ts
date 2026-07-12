import type { Config } from 'jest';

export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
} satisfies Config;
