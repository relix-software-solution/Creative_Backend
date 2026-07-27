import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class StaffOfflineSnapshotQueryDto {
  /**
   * Cursor مشفّر يعيده السيرفر من الصفحة السابقة.
   *
   * لا ينشئه الفرونت بنفسه.
   */
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * الحد الأعلى 500 حتى لا يتحول الطلب إلى Payload ضخم
   * أو يستهلك ذاكرة السيرفر والمتصفح دفعة واحدة.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return 500;
    }

    return Number(value);
  })
  @IsInt()
  @Min(50)
  @Max(500)
  limit: number = 500;
}
