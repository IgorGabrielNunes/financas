export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const notFound = (o = 'Registro') => new HttpError(404, `${o} não encontrado`);
export const conflict = (m: string) => new HttpError(409, m);
export const badRequest = (m: string) => new HttpError(400, m);
