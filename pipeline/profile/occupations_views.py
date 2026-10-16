"""Views over the occupation parts and the warehouse action rows, shared by the report and ad hoc queries."""
VIEWS = r"""
CREATE OR REPLACE TEMP VIEW ent AS SELECT * FROM read_csv('pipeline/crosswalks/entities.csv', all_varchar=true);
CREATE OR REPLACE TEMP VIEW agency_dept AS SELECT code AS agency_code, parent_code AS department_code
  FROM ent WHERE level = 'agency';
-- employment: one row per month x agency x subelement x series; department resolved from the agency code
CREATE OR REPLACE TEMP VIEW emp AS
  SELECT e.period, d.department_code, e.agency_code, e.agency_subelement_code, e.occupational_series_code, e.headcount
  FROM read_parquet('warehouse/profile/parts/occ_emp/*.parquet') e LEFT JOIN agency_dept d USING (agency_code);
CREATE OR REPLACE TEMP VIEW emp_names AS SELECT * FROM read_parquet('warehouse/profile/parts/occ_names/*.parquet');
-- actions: every typed row in range, by effective month, resolved department (as the cubes count them)
CREATE OR REPLACE TEMP VIEW acc AS
  SELECT period, effective_month, department_code, agency_code, agency_subelement_code, action_code,
         occupational_series_code, occupational_series, occupational_group_code, occupational_group,
         occupational_category_code, occupational_category, pay_plan_code
  FROM w.accession_rows WHERE NOT effective_before_range;
CREATE OR REPLACE TEMP VIEW sep AS
  SELECT period, effective_month, department_code, agency_code, agency_subelement_code, action_code,
         occupational_series_code, occupational_series, occupational_group_code, occupational_group,
         occupational_category_code, occupational_category, pay_plan_code
  FROM w.separation_rows WHERE NOT effective_before_range;
"""
