import { HttpException } from "@nestjs/common";

/** Carries only static, reviewed Problem Details metadata to the global filter. */
export class EvidenceUploadHttpError extends HttpException {
  constructor(
    status: number,
    readonly problemCode: string,
    readonly safeDetail: string,
  ) {
    super(safeDetail, status);
    this.name = "EvidenceUploadHttpError";
  }
}
