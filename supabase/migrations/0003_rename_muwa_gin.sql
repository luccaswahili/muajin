update public.products set name = 'Muwa Dry Gin' where name = 'Muajin Dry Gin';
update public.products set name = 'Muwa Coffee Gin', description = 'Coffee flavoured gin, 200ml, 30 per carton' where name = 'Muajin Coffee';
update public.settings set value = '"Muwa Gin"' where key = 'company_name';
update public.settings set value = '"Muwa Gin official account"' where key = 'bank_name';
