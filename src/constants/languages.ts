// Shared programming language constants
export const PROGRAMMING_LANGUAGES = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'java', label: 'Java' },
  { value: 'golang', label: 'Go' },
  { value: 'cpp', label: 'C++' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'sql', label: 'SQL' },
  { value: 'r', label: 'R' },
  { value: 'csharp', label: 'C#' },
  { value: 'rust', label: 'Rust' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'php', label: 'PHP' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'less', label: 'Less' },
  { value: 'sass', label: 'Sass' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'sql', label: 'SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'redis', label: 'Redis' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'dockercompose', label: 'Docker Compose' },
  { value: 'terraform', label: 'Terraform' },
  { value: 'ansible', label: 'Ansible' },
  { value: 'puppet', label: 'Puppet' },
  { value: 'chef', label: 'Chef' },
  { value: 'salt', label: 'Salt' },
  { value: 'chef', label: 'Chef' },
  { value: 'salt', label: 'Salt' },
  { value: 'chef', label: 'Chef' },
] as const;

// Type for programming language values
export type ProgrammingLanguage = typeof PROGRAMMING_LANGUAGES[number]['value'];

// Default programming language
export const DEFAULT_PROGRAMMING_LANGUAGE: ProgrammingLanguage = 'python';

