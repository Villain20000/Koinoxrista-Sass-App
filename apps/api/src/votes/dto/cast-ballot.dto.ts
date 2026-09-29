import { IsIn } from 'class-validator';

export class CastBallotDto {
  @IsIn(['YES', 'NO', 'ABSTAIN'])
  choice!: 'YES' | 'NO' | 'ABSTAIN';
}
