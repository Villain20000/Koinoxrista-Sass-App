import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  SupplierInvoiceDto,
  SupplierInvoiceListResponseDto,
  SupplierInvoiceStatsDto,
  CreateManualSupplierInvoiceDto,
  PullMyDataResponseDto,
  SupplierInvoiceStatus,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupplierInvoicesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  list(
    buildingId: string,
    params?: {
      status?: SupplierInvoiceStatus | string;
      from?: string;
      to?: string;
      skip?: number;
      take?: number;
      page?: number;
      limit?: number;
    },
  ): Observable<SupplierInvoiceListResponseDto> {
    let httpParams = new HttpParams();
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.from) httpParams = httpParams.set('from', params.from);
    if (params?.to) httpParams = httpParams.set('to', params.to);
    if (params?.skip !== undefined) httpParams = httpParams.set('skip', String(params.skip));
    if (params?.take !== undefined) httpParams = httpParams.set('take', String(params.take));
    if (params?.page !== undefined) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit !== undefined) httpParams = httpParams.set('limit', String(params.limit));
    return this.http.get<SupplierInvoiceListResponseDto>(`${this.base}/${buildingId}/supplier-invoices`, {
      params: httpParams,
    });
  }

  getById(buildingId: string, id: string): Observable<SupplierInvoiceDto> {
    return this.http.get<SupplierInvoiceDto>(`${this.base}/${buildingId}/supplier-invoices/${id}`);
  }

  stats(buildingId: string): Observable<SupplierInvoiceStatsDto> {
    return this.http.get<SupplierInvoiceStatsDto>(`${this.base}/${buildingId}/supplier-invoices/stats`);
  }

  createManual(buildingId: string, dto: CreateManualSupplierInvoiceDto): Observable<SupplierInvoiceDto> {
    return this.http.post<SupplierInvoiceDto>(`${this.base}/${buildingId}/supplier-invoices/manual`, dto);
  }

  importJson(buildingId: string, json: Record<string, unknown>): Observable<SupplierInvoiceDto> {
    return this.http.post<SupplierInvoiceDto>(`${this.base}/${buildingId}/supplier-invoices/import-json`, json);
  }

  importPdf(buildingId: string, file: File): Observable<SupplierInvoiceDto> {
    const form = new FormData();
    form.set('file', file);
    return this.http.post<SupplierInvoiceDto>(`${this.base}/${buildingId}/supplier-invoices/import-pdf`, form);
  }

  pullMyData(buildingId: string): Observable<PullMyDataResponseDto> {
    return this.http.post<PullMyDataResponseDto>(`${this.base}/${buildingId}/supplier-invoices/pull-mydata`, {});
  }

  match(
    buildingId: string,
    invoiceId: string,
    expenseId?: string,
  ): Observable<SupplierInvoiceDto> {
    return this.http.post<SupplierInvoiceDto>(
      `${this.base}/${buildingId}/supplier-invoices/${invoiceId}/match`,
      expenseId ? { expenseId } : {},
    );
  }

  void(buildingId: string, invoiceId: string): Observable<SupplierInvoiceDto> {
    return this.http.post<SupplierInvoiceDto>(`${this.base}/${buildingId}/supplier-invoices/${invoiceId}/void`, {});
  }
}
