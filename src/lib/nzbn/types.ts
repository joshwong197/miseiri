// Subset of NZBN API response types we depend on. Defensive — many
// fields may be missing depending on consent flags or entity type.

export interface NzbnAddress {
  addressType?: "REGISTERED" | "POSTAL" | "SERVICE" | string;
  address1?: string;
  address2?: string;
  address3?: string;
  postCode?: string;
  countryCode?: string;
  startDate?: string;
}

export interface NzbnTradingName {
  name: string;
  startDate?: string;
  endDate?: string | null;
}

export interface NzbnClassification {
  classificationCode?: string;
  classificationDescription?: string;
}

export interface NzbnEntity {
  nzbn: string;
  entityName: string;
  entityTypeCode?: string;
  entityTypeDescription?: string;
  entityStatusCode?: string;
  entityStatusDescription?: string;
  registrationDate?: string;
  sourceRegister?: string;
  sourceRegisterUniqueIdentifier?: string;
  tradingNames?: NzbnTradingName[];
  // Sometimes a flat array, sometimes wrapped — handle both.
  addresses?: NzbnAddress[] | { addressList: NzbnAddress[] };
  phoneNumbers?: { phoneNumber?: string; phoneAreaCode?: string }[];
  emailAddresses?: { emailAddress?: string }[];
  websites?: { url?: string }[];
  classifications?: NzbnClassification[];
}

export interface NzbnSearchResponse {
  totalResults: number;
  page: number;
  pageSize: number;
  items: NzbnEntity[];
}

// Normalised result of /entities/{nzbn}/gst. The endpoint's exact response
// shape varies (object vs array, nested vs flat) so the client extracts a
// flat record. `null` from getGst means "no GST data exposed for this
// entity" — could be opted-out, never-registered, or simply not on the
// register. We can't distinguish those without more signal.
export interface NzbnGstInfo {
  gstNumber: string | null;
  registered: boolean;
}
