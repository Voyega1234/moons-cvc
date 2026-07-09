update moons.brand_documents
set document_type = 'other'
where document_type not in (
  'brand_guideline',
  'product_factsheet',
  'campaign_brief',
  'claim_support',
  'reference',
  'report',
  'other'
);

alter table moons.brand_documents
  drop constraint if exists brand_documents_document_type_check;

alter table moons.brand_documents
  add constraint brand_documents_document_type_check
  check (
    document_type in (
      'brand_guideline',
      'product_factsheet',
      'campaign_brief',
      'claim_support',
      'reference',
      'report',
      'other'
    )
  );
