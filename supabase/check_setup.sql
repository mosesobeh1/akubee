-- Shows which parts are installed. A NULL means that migration has not been applied yet.
select
  to_regclass('public.profiles')               as m001_catalogue,
  to_regclass('public.orders')                 as m002_orders,
  to_regclass('public.quotation_requests')     as m003_wholesale,
  to_regclass('public.payments')               as m004_payments,
  (select column_name from information_schema.columns where table_name='orders' and column_name='tracking_info') as m005_admin,
  to_regclass('public.rate_limits')            as m006_hardening,
  to_regclass('public.promotions')             as m007_promotions;
