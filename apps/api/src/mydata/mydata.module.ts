import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { createMyDataProvider, MYDATA_PROVIDER } from './mydata.adapter';
import { MyDataController } from './mydata.controller';
import { MyDataService } from './mydata.service';

@Module({
  imports: [AuthModule],
  controllers: [MyDataController],
  providers: [
    MyDataService,
    { provide: MYDATA_PROVIDER, useFactory: () => createMyDataProvider() },
  ],
})
export class MyDataModule {}
