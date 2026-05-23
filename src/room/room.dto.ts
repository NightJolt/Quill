import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString, ArrayUnique, ArrayMaxSize } from 'class-validator';

export class CreateRoomReq {
  @ApiProperty({
    required: false,
    description: 'Optional display name for the room.',
    example: 'Apartment 304 — General',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description:
      'Creator userId (24-char hex). Required — every room has a creator, even when minted server-side. Added to participants automatically.',
    example: '507f1f77bcf86cd799439011',
    pattern: '^[a-fA-F0-9]{24}$',
  })
  @IsMongoId()
  createdBy!: string;

  @ApiProperty({
    required: false,
    description:
      'Initial participants (24-char hex userIds). Inserted in the same transaction as the room. `createdBy` is always included once, regardless of presence here.',
    example: ['507f1f77bcf86cd799439011', '507f191e810c19729de860ea'],
    maxItems: 500,
    uniqueItems: true,
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(500)
  initialParticipants?: string[];
}

export interface RoomRes {
  id: string;
  appId: string;
  name?: string;
  createdBy: string;
  createdAt: string;
}
