export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
