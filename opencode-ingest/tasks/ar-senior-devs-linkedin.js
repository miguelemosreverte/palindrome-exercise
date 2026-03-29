import { LinkedInFetcher } from '../vendors/linkedin/fetch.js';

export default class extends LinkedInFetcher {
  constructor(name, dir) {
    super(name, dir, {
      queries: [
        'senior software engineer',
        'staff engineer',
        'principal engineer',
        'tech lead developer',
        'engineering manager software',
        'software architect',
        'senior backend developer',
        'senior fullstack developer',
        'CTO startup',
        'VP engineering',
      ],
      maxPages: 100,
    });
  }
}
