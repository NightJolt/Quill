import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsMongoId } from 'class-validator';

export class AddParticipantsReq {
  @ApiProperty({
    description:
      'UserIds to add (24-char hex). Idempotent — adding existing participants is a no-op. At least 1, at most 500 per call.',
    example: ['507f1f77bcf86cd799439011', '507f191e810c19729de860ea'],
    minItems: 1,
    maxItems: 500,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsMongoId({ each: true })
  userIds!: string[];
}

export interface ParticipantRes {
  appId: string;
  roomId: string;
  userId: string;
  joinedAt: string;
  lastReadAt: string | null;
}
