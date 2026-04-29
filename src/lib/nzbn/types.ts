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
