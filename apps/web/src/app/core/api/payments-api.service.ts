import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreatePaymentOrderResponse,
  Invoice,
  PaymentOrder,
  PaymentStatus,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** A recorded payment on an invoice (joined by the API in invoice detail). */
export interface InvoicePaymentView {
  id: string;
  amountCents: number;
  method: string | null;
  status: PaymentStatus;
  pspRef: string | null;
  createdAt?: string;
}

/** Invoice detail including its payments and checkout orders. */
export interface InvoiceDetailView extends Invoice {
  payments: InvoicePaymentView[];
  orders: PaymentOrder[];
}

@Injectable({ providedIn: 'root' })
export class PaymentsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/invoices`;

  /** Creates a PSP checkout order for the (remaining) invoice amount. */
  pay(invoiceId: string): Observable<CreatePaymentOrderResponse> {
    return this.http.post<CreatePaymentOrderResponse>(
      `${this.base}/${invoiceId}/pay`,
      {},
    );
  }

  detail(invoiceId: string): Observable<InvoiceDetailView> {
    return this.http.get<InvoiceDetailView>(`${this.base}/${invoiceId}`);
  }

  receiptUrl(invoiceId: string): string {
    return `${this.base}/${invoiceId}/receipt.html`;
  }

  /** Human label for a payment method code (CARD / IRIS / PIX / …). */
  methodLabel(method: string | null | undefined): string {
    switch (method) {
      case 'CARD':
        return 'Κάρτα';
      case 'IRIS':
        return 'IRIS';
      case 'PIX':
        return 'PIX';
      case 'ACH':
        return 'ACH';
      case 'SPEI':
        return 'SPEI';
      case 'SEPA_DD':
        return 'SEPA Direct Debit';
      case 'INTERAC':
        return 'Interac';
      default:
        return method || '—';
    }
  }
}
