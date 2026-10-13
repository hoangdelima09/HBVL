import { ArgumentMetadata, applyDecorators, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import { E } from './errors';

/** Validates with a zod schema; strict schemas reject unknown (e.g. privileged) fields. */
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.output<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw E.validation(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return r.data;
  }
}

export const ZodBody = <T extends ZodType>(schema: T) => applyDecorators(ApiBody({ schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as never }));
export const body = <T extends ZodType>(schema: T) => Body(new ZodPipe(schema));
export const query = <T extends ZodType>(schema: T) => Query(new ZodPipe(schema));
