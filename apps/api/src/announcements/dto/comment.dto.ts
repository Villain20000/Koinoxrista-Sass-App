import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /announcements/:id/comments` (Q&A under an announcement). */
export class CommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}
