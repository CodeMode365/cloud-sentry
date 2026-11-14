/**
 * SYNTHETIC Price List documents shaped like real pricing:GetProducts (aws_v1) responses. Attribute names,
 * usage types and the example prices follow the live us-east-1 responses described in
 * docs/architecture/extended-services.md section 4 (2026-11-14). Test data only.
 */

export interface DimensionInput {
  usd: string;
  unit: string;
  beginRange?: string;
  endRange?: string;
  description?: string;
}

export interface EntryInput {
  sku: string;
  usagetype: string;
  productFamily?: string;
  attributes?: Record<string, string>;
  /** One price dimension per tier. Defaults: beginRange "0", endRange "Inf". */
  dimensions: DimensionInput[];
}

/** Serialized Price List document (GetProducts returns each product as a JSON string). */
export function priceListEntry(input: EntryInput): string {
  const termKey = `${input.sku}.JRTCKXETXF`;
  const priceDimensions: Record<string, unknown> = {};
  input.dimensions.forEach((d, i) => {
    priceDimensions[`${termKey}.RATE${i}`] = {
      unit: d.unit,
      beginRange: d.beginRange ?? '0',
      endRange: d.endRange ?? 'Inf',
      description: d.description ?? `${d.usd} USD per ${d.unit}`,
      appliesTo: [],
      rateCode: `${termKey}.RATE${i}`,
      pricePerUnit: { USD: d.usd },
    };
  });
  return JSON.stringify({
    product: {
      sku: input.sku,
      productFamily: input.productFamily ?? 'x',
      attributes: { usagetype: input.usagetype, regionCode: 'us-east-1', ...input.attributes },
    },
    serviceCode: 'x',
    terms: {
      OnDemand: {
        [termKey]: {
          offerTermCode: 'JRTCKXETXF',
          sku: input.sku,
          effectiveDate: '2026-11-01T00:00:00Z',
          priceDimensions,
          termAttributes: {},
        },
      },
    },
    version: '20261101000000',
    publicationDate: '2026-11-01T00:00:00Z',
  });
}

/** Single-dimension shorthand. */
export function simpleEntry(
  sku: string,
  usagetype: string,
  unit: string,
  usd: string,
  attributes: Record<string, string> = {},
): string {
  return priceListEntry({ sku, usagetype, attributes, dimensions: [{ usd, unit }] });
}
