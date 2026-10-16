# Occupations feasibility profile (L-025)

Read-only profile for two proposed features: lists of the occupations most hired and most departed, and a filter by
occupation (job) on the dashboard. Built by `pipeline/profile/occupations.py` (employment parts, one source file at a
time, 179 files in about 30 s) and `pipeline/profile/occupations_report.py` (queries; each result cached under
`warehouse/profile/occ_results/`). Source: the 537 files of manifest 86d0cd47076a (Oct 2011 to Aug 2026).
Accessions and separations come from the warehouse action rows (`accession_rows`, `separation_rows`, effective month,
resolved department, actions effective before Oct 2011 excluded), so totals equal the cubes (GOV FY2025 departures
369,153 and t12 departures 329,623, Q4.3). Employment comes from per-file parts that reproduce `emp_org_month`
exactly (22,371 month-department rows, 381,459,856 person-months, 0 differences; checked when the parts were built).
"Series" means `occupational_series_code` as published. Hires = accession rows, departures = separation rows (metric
spec section 3); transfers are AA, AB in and SA, SB out. t12 = Sep 2025 to Aug 2026. The SQL for every table is in
the appendix.

## 1. Occupation fields

**Answer.** All three datasets carry the same occupation fields in every one of the 179 files: the series
(`occupational_series_code`, `occupational_series`), OPM's family (`occupational_group_code`, `occupational_group`),
the PATCOB category (`occupational_category_code`, `occupational_category`), `stem_occupation` and
`stem_occupation_type`, and the pay plan (`pay_plan_code`, `pay_plan`) (Q1.1, Q1.2). The series code is never NULL
(Q1.3) and never REDACTED (Q2.4). The category is the weak field: on separations it is NULL 151,633 times and
"NO DATA REPORTED" 384,971 times (KDI-002, Q1.4), so it cannot be used for departures from Jun 2024.

Occupation and pay plan columns: files containing each column, first and last file (parquet metadata of all 537 source files)  [query Q1.1]
```
dataset      column_name                 files  first_file  last_file  parquet_type
-----------  --------------------------  -----  ----------  ---------  ------------
accessions   occupational_category         179      201110     202608  BYTE_ARRAY
employment   occupational_category         179      201110     202608  BYTE_ARRAY
separations  occupational_category         179      201110     202608  BYTE_ARRAY
accessions   occupational_category_code    179      201110     202608  BYTE_ARRAY
employment   occupational_category_code    179      201110     202608  BYTE_ARRAY
separations  occupational_category_code    179      201110     202608  BYTE_ARRAY
accessions   occupational_group            179      201110     202608  BYTE_ARRAY
employment   occupational_group            179      201110     202608  BYTE_ARRAY
separations  occupational_group            179      201110     202608  BYTE_ARRAY
accessions   occupational_group_code       179      201110     202608  BYTE_ARRAY
employment   occupational_group_code       179      201110     202608  BYTE_ARRAY
separations  occupational_group_code       179      201110     202608  BYTE_ARRAY
accessions   occupational_series           179      201110     202608  BYTE_ARRAY
employment   occupational_series           179      201110     202608  BYTE_ARRAY
separations  occupational_series           179      201110     202608  BYTE_ARRAY
accessions   occupational_series_code      179      201110     202608  BYTE_ARRAY
employment   occupational_series_code      179      201110     202608  BYTE_ARRAY
separations  occupational_series_code      179      201110     202608  BYTE_ARRAY
accessions   pay_plan                      179      201110     202608  BYTE_ARRAY
employment   pay_plan                      179      201110     202608  BYTE_ARRAY
separations  pay_plan                      179      201110     202608  BYTE_ARRAY
accessions   pay_plan_code                 179      201110     202608  BYTE_ARRAY
employment   pay_plan_code                 179      201110     202608  BYTE_ARRAY
separations  pay_plan_code                 179      201110     202608  BYTE_ARRAY
accessions   stem_occupation               179      201110     202608  BYTE_ARRAY
employment   stem_occupation               179      201110     202608  BYTE_ARRAY
separations  stem_occupation               179      201110     202608  BYTE_ARRAY
accessions   stem_occupation_type          179      201110     202608  BYTE_ARRAY
employment   stem_occupation_type          179      201110     202608  BYTE_ARRAY
separations  stem_occupation_type          179      201110     202608  BYTE_ARRAY
```

Files per dataset (denominator for Q1.1)  [query Q1.2]
```
dataset      files
-----------  -----
accessions     179
employment     179
separations    179
```

NULL values per occupation field, all files (employment = person-months)  [query Q1.3]
```
dataset             rows  series_code_null  series_name_null  group_code_null  category_code_null  category_name_null  pay_plan_code_null
-----------  -----------  ----------------  ----------------  ---------------  ------------------  ------------------  ------------------
accessions     3,642,007                                  17               17                 159                 159                 124
employment   381,459,856                               1,058            1,058               8,650               8,650              24,281
separations    3,658,823                                  21               21             151,633             151,633                  39
```

Occupational category values (all files, all three datasets; employment = person-months)  [query Q1.4]
```
occupational_category_code  occupational_category  accessions  separations  employment_person_months
--------------------------  ---------------------  ----------  -----------  ------------------------
                            NO DATA REPORTED                7      384,971                         1
*                           INVALID                     2,228        1,606                   155,388
A                           ADMINISTRATIVE            901,943      915,064               145,046,663
B                           BLUE COLLAR               400,181      335,450                33,752,120
C                           CLERICAL                  497,529      326,008                22,994,993
O                           OTHER WHITE COLLAR        243,892      169,962                14,799,586
P                           PROFESSIONAL              820,696      651,202               104,175,973
T                           TECHNICAL                 775,372      722,927                60,526,482
                                                          159      151,633                     8,650
```

## 2. Series codes: counts, drift and unusable values

**Answer.** 721 distinct 4-digit series codes appear over all files (any dataset), 669 in the latest 12 months; 663
in the Aug 2026 employment file (Q2.1). There is no spelling drift: no code ever has two different spellings. The only
"second name" is a NULL name on 7 codes, on a handful of rows (Mar 2018 files; three codes in 2024 to 2026
separations) (Q2.2, Q2.3, Q3.2). One name sits on two codes legitimately: ELECTRICIAN is 2805 and 9940 (vessel jobs).
Unusable values are of two kinds only: `*` INVALID (accessions 2,379, separations 2,050, employment 155,963
person-months) and a blank code `' '` named "NO DATA REPORTED" (separations 19,140, accessions 7) (Q2.4). No REDACTED,
no other non-4-digit value. Rates stay under 0.15% everywhere (Q2.5) except separations FY2016 (1.72%, the Mar and Apr
2016 files), FY2024 (0.63%), FY2025 (2.77%) and FY2026 (1.94%).

**KDI-002 does reach the series code, but only a little.** In the Jun 2024 to Aug 2026 separations files, 532,342
rows have a bad category, and 517,002 of those still carry a valid 4-digit series (Q2.8). The blank-series rate rises
from 0.19% (files before Jun 2024) to 2.37%, peaking at 10.14% in the Mar 2026 file (Q2.9). Worst departments,
latest 12 months of separations: AM 11.83%, AG 6.75%, TR 6.43%, DN 6.33%, ST 5.62% (Q2.6). Employment is clean
(worst Aug 2026: RF 1.29% of 232; VA 0.26%; Q2.7). The blank code would rank 5th among government-wide departures
in FY2025 (9,988) and the latest 12 months (8,642) (Q4.2a, Q4.2b), so any list must show it as its own "not
reported" row with its count, not drop it. Recording it would need a known data issue entry (a KDI-002 scope
extension or a new KDI), which needs the owner's sign-off.

Distinct series codes per dataset: all files and the latest 12 months (effective / snapshot months Sep 2025 to Aug 2026), all values and 4-digit codes only  [query Q2.1]
```
dataset           codes_all_time  four_digit_all_time  codes_t12  four_digit_t12  four_digit_aug2026
----------------  --------------  -------------------  ---------  --------------  ------------------
accessions                   677                  675        553             551                 399
any of the three             723                  721        671             669
employment                   719                  718        669             668                 663
separations                  695                  693        638             636                 392
```

Spelling drift: 4-digit codes with more than one published series name across all files (any dataset)  [query Q2.2]
```
codes  codes_with_2plus_names  max_names_per_code  names_on_2plus_codes
-----  ----------------------  ------------------  --------------------
  721                       4                   2                     2
```

Spelling drift detail: every code with more than one name, each name with its first and last file month  [query Q2.3]
```
code  name                          first_file  last_file    rows
----  ----------------------------  ----------  ---------  ------
0243  APPRENTICESHIP AND TRAINING      2011-10    2026-08   6,876
0243                                   2018-03    2018-03       1
0593  INSURANCE ACCOUNTS               2011-10    2018-02     951
0593                                   2018-03    2018-03       3
0605  NURSE ANESTHETIST (TITLE 38)     2011-10    2019-06  72,128
0605                                   2018-03    2018-03   1,077
0625  AUTOPSY ASSISTANT                2011-10    2018-02     902
0625                                   2018-03    2018-03       1
```

Values that are not a 4-digit code, and 4-digit codes with a placeholder name, by dataset (all files)  [query Q2.4]
```
dataset      class         code_as_published  name                 rows
-----------  ------------  -----------------  ----------------  -------
accessions   star_invalid  [*]                INVALID             2,379
accessions   blank         [ ]                NO DATA REPORTED        7
employment   star_invalid  [*]                INVALID           155,963
separations  blank         [ ]                NO DATA REPORTED   19,140
separations  star_invalid  [*]                INVALID             2,050
```

Rate of unusable series codes (blank, *, REDACTED, other non-4-digit) by dataset and fiscal year of the effective month (employment: person-months of the fiscal year)  [query Q2.5]
```
dataset      fy            rows  blank  star_invalid  redacted  other  pct_unusable
-----------  ------  ----------  -----  ------------  --------  -----  ------------
accessions   FY2012     218,543                   50                          0.023
accessions   FY2013     185,354                   54                          0.029
accessions   FY2014     205,184                   65                          0.032
accessions   FY2015     250,972                   59                          0.024
accessions   FY2016     260,606                   98                          0.038
accessions   FY2017     228,688                   55                          0.024
accessions   FY2018     255,749                  142                          0.056
accessions   FY2019     280,843                  260                          0.093
accessions   FY2020     274,648                  232                          0.084
accessions   FY2021     262,786                  204                          0.078
accessions   FY2022     308,800                  222                          0.072
accessions   FY2023     325,639                  301                          0.092
accessions   FY2024     283,157                  252                          0.089
accessions   FY2025     152,831                  179                          0.117
accessions   FY2026     148,207      7           206                          0.144
employment   FY2012  25,306,810                3,326                          0.013
employment   FY2013  25,046,682                2,682                          0.011
employment   FY2014  24,539,857                2,076                          0.008
employment   FY2015  24,626,583                2,118                          0.009
employment   FY2016  24,927,421                2,636                          0.011
employment   FY2017  25,110,064                2,342                          0.009
employment   FY2018  25,063,258                9,300                          0.037
employment   FY2019  25,315,169               16,791                          0.066
employment   FY2020  25,767,502               16,851                          0.065
employment   FY2021  26,145,416               16,554                          0.063
employment   FY2022  26,024,386               16,667                          0.064
employment   FY2023  26,503,624               16,928                          0.064
employment   FY2024  27,407,556               16,113                          0.059
employment   FY2025  27,205,009               16,704                          0.061
employment   FY2026  22,470,519               14,875                          0.066
separations  FY2012     241,699                   46                          0.019
separations  FY2013     229,257                   58                          0.025
separations  FY2014     224,652     16            55                          0.032
separations  FY2015     230,871    100            58                          0.068
separations  FY2016     234,441  3,956            77                           1.72
separations  FY2017     227,728     26            65                           0.04
separations  FY2018     234,710     18           102                          0.051
separations  FY2019     242,581      9           212                          0.091
separations  FY2020     222,772     19           204                            0.1
separations  FY2021     250,707     53           203                          0.102
separations  FY2022     290,065     35           193                          0.079
separations  FY2023     240,684     54           187                            0.1
separations  FY2024     222,829  1,219           182                          0.629
separations  FY2025     369,153  9,988           231                          2.768
separations  FY2026     196,674  3,647           177                          1.944
```

Top 10 departments by unusable-code rate, per action dataset, all effective months (departments with at least 1,000 actions) and the latest 12 months (at least 100)  [query Q2.6]
```
dataset      span  rnk  department_code     rows  unusable    pct
-----------  ----  ---  ---------------  -------  --------  -----
accessions   all     1  BG                 1,300        34   2.62
accessions   all     2  ED                 5,778       102   1.77
accessions   all     3  HF                 1,461         6   0.41
accessions   all     4  DL                17,411        46   0.26
accessions   all     5  EE                 2,590         6   0.23
accessions   all     6  VA               752,708     1,645   0.22
accessions   all     7  EP                15,135        33   0.22
accessions   all     8  NL                 1,309         2   0.15
accessions   all     9  NF                 3,293         5   0.15
accessions   all    10  NU                 2,744         4   0.15
accessions   t12     1  DN                   691         8   1.16
accessions   t12     2  EP                   107         1   0.93
accessions   t12     3  VA                38,636       202   0.52
accessions   t12     4  SZ                 1,716         3   0.17
accessions   t12     5  IN                10,413        12   0.12
accessions   t12     6  HE                 2,616         1   0.04
accessions   t12     7  CM                 5,082         1   0.02
accessions   t12     8  AG                 8,446         0      0
accessions   t12     9  DJ                 8,630         0      0
accessions   t12    10  DL                   521         0      0
separations  all     1  AM                 9,735       699   7.18
separations  all     2  AH                 1,170        38   3.25
separations  all     3  TR               191,158     4,279   2.24
separations  all     4  BG                 1,552        33   2.13
separations  all     5  KS                 2,121        33   1.56
separations  all     6  HU                13,160       178   1.35
separations  all     7  ST                22,722       298   1.31
separations  all     8  FR                 2,715        34   1.25
separations  all     9  DN                22,452       259   1.15
separations  all    10  ED                 8,081        92   1.14
separations  t12     1  AM                 1,649       195  11.83
separations  t12     2  AG                22,827     1,541   6.75
separations  t12     3  TR                30,092     1,936   6.43
separations  t12     4  DN                 2,798       177   6.33
separations  t12     5  ST                 3,041       171   5.62
separations  t12     6  CM                 6,588       277    4.2
separations  t12     7  DOD              104,640     3,322   3.17
separations  t12     8  FR                   386        12   3.11
separations  t12     9  HS                27,425       738   2.69
separations  t12    10  SB                 2,866        66    2.3
```

Employment: top 10 departments by unusable-code rate, Aug 2026 snapshot (departments of 100+)  [query Q2.7]
```
department_code  headcount  unusable   pct
---------------  ---------  --------  ----
RF                     232         3  1.29
GW                     247         1   0.4
VA                 447,225     1,168  0.26
TC                     417         1  0.24
FT                   1,035         1   0.1
NL                   1,061         1  0.09
EP                  12,397         7  0.06
IN                  59,776        38  0.06
HE                  72,783        35  0.05
ED                   2,294         1  0.04
```

KDI-002 and the series code: separations, files before and from Jun 2024  [query Q2.8]
```
files                       separations  category_bad  category_bad_series_4_digit  series_not_4_digit  pct_series_not_4_digit  group_bad
--------------------------  -----------  ------------  ---------------------------  ------------------  ----------------------  ---------
Oct 2011 to May 2024 files    3,011,455         4,262                            0               5,835                    0.19      5,842
Jun 2024 to Aug 2026 files      647,368       532,342                      517,002              15,355                    2.37     15,369
```

Separations with a blank series code, by file month, Jun 2024 onward (KDI-002 period)  [query Q2.9]
```
file_month  separations  blank_series    pct
----------  -----------  ------------  -----
   2024-06       21,097           463   2.19
   2024-07       17,724           198   1.12
   2024-08       21,044           295    1.4
   2024-09       20,311           250   1.23
   2024-10       18,598           248   1.33
   2024-11       17,965           275   1.53
   2024-12       23,916           307   1.28
   2025-01       22,259           405   1.82
   2025-02       15,604           276   1.77
   2025-03       22,061           355   1.61
   2025-04       24,088           256   1.06
   2025-05       26,415           479   1.81
   2025-06       19,947           387   1.94
   2025-07       22,640           365   1.61
   2025-08       18,253           118   0.65
   2025-09      120,540           796   0.66
   2025-10       12,407            38   0.31
   2025-11       19,357           275   1.42
   2025-12       29,908           497   1.66
   2026-01       37,597         2,371   6.31
   2026-02       16,627         1,527   9.18
   2026-03       21,531         2,184  10.14
   2026-04       15,312           727   4.75
   2026-05       17,105           241   1.41
   2026-06       16,271           587   3.61
   2026-07       16,521           870   5.27
   2026-08       12,270            88   0.72
```

## 3. Families and blue collar

**Answer.** OPM publishes the family. `occupational_group_code` equals the first two digits of the series code in
every published code-group pair (0 differ, Q3.1); it is NULL only for 7 codes on a few rows (Q3.2). The family name
is in `occupational_group`, with one spelling per code over all files (Q3.3, Q3.4 no variants). Aug 2026 has 59
families: 23 white-collar groups (00 to 22, named "... GROUP", for example 03 General Administrative, Clerical, and
Office Services 268,107; 06 Medical, Hospital, Dental, and Public Health 340,526; 22 Information Technology 84,894
with 3 codes) and 36 wage-system families (25 to 99, named "... FAMILY", for example 28 Electrical Installation and
Maintenance, 57 Transportation/Mobile Equipment Operation) (Q3.3).

Blue collar is distinguishable by the code, not the pay plan. Every 4-digit code of 2500 and above is category B
(BLUE COLLAR) and no code below 2500 is, in all three datasets over all files (Q3.5; the separations rows with a
blank category are KDI-002). Pay plan is not a clean test: in Aug 2026 employment, 161,482 people in wage codes are on
a W pay plan and 5,810 are not (BB 1,399, NA 1,229, XF 428, CY 412 and others, Q3.6, Q3.7); no code below 2500 is ever
on a W plan (Q3.6). So "blue collar" can be defined as series code 2500 and above (identical to OPM's category B
where the category is populated), which also works for separations where KDI-002 blanks the category.

Does occupational_group_code equal the first two digits of the series code? (distinct code pairs, all files)  [query Q3.1]
```
dataset      code_group_pairs  equal_first_two  group_null  differ
-----------  ----------------  ---------------  ----------  ------
accessions                676              675           1       0
employment                722              718           4       0
separations               694              690           4       0
```

4-digit codes published with a NULL group code (rows, all files)  [query Q3.2]
```
dataset      code  name   rows  first_file  last_file
-----------  ----  ----  -----  ----------  ---------
accessions   0605           17     2018-03    2018-03
employment   0243            1     2018-03    2018-03
employment   0593            3     2018-03    2018-03
employment   0605        1,053     2018-03    2018-03
employment   0625            1     2018-03    2018-03
separations  0000           10     2025-01    2026-07
separations  0182            1     2025-03    2025-03
separations  0183            3     2024-11    2025-03
separations  0605            7     2018-03    2018-03
```

Families as OPM publishes them: group code, names over all files, codes, Aug 2026 headcount  [query Q3.3]
```
grp  names_all_files  latest_name                                                              codes_aug2026  headcount_aug2026
---  ---------------  -----------------------------------------------------------------------  -------------  -----------------
 00                1  MISCELLANEOUS OCCUPATIONS GROUP                                                     27             96,506
 01                1  SOCIAL SCIENCE, PSYCHOLOGY, AND WELFARE GROUP                                       29            102,385
 02                1  HUMAN RESOURCES MANAGEMENT GROUP                                                     7             43,897
 03                1  GENERAL ADMINISTRATIVE, CLERICAL, AND OFFICE SERVICES GROUP                         31            268,107
 04                1  BIOLOGICAL SCIENCES GROUP                                                           31             67,452
 05                1  ACCOUNTING AND BUDGET GROUP                                                         18             99,101
 06                1  MEDICAL, HOSPITAL, DENTAL, AND PUBLIC HEALTH GROUP                                  45            340,526
 07                1  VETERINARY MEDICAL SCIENCE GROUP                                                     3              1,940
 08                1  ENGINEERING AND ARCHITECTURE GROUP                                                  29            123,796
 09                1  LEGAL AND KINDRED GROUP                                                             18            111,411
 10                1  INFORMATION AND ARTS GROUP                                                          19             15,128
 11                1  BUSINESS AND INDUSTRY GROUP                                                         25             93,366
 12                1  COPYRIGHT, PATENT, AND TRADEMARK GROUP                                               7             10,507
 13                1  PHYSICAL SCIENCES GROUP                                                             25             27,092
 14                1  LIBRARY AND ARCHIVES GROUP                                                           5              3,256
 15                1  MATHEMATICS AND STATISTICS GROUP                                                    11             22,846
 16                1  EQUIPMENT, FACILITIES, AND SERVICES GROUP                                            8             15,837
 17                1  EDUCATION GROUP                                                                     11             35,612
 18                1  INVESTIGATION GROUP                                                                 20            214,129
 19                1  QUALITY ASSURANCE, INSPECTION, AND GRADING GROUP                                     4             10,751
 20                1  SUPPLY GROUP                                                                         8             24,621
 21                1  TRANSPORTATION GROUP                                                                20             43,107
 22                1  INFORMATION TECHNOLOGY GROUP                                                         3             84,894
 25                1  WIRE COMMUNICATIONS EQUIPMENT INSTALLATION AND MAINTENANCE FAMILY                    3                312
 26                1  ELECTRONIC EQUIPMENT INSTALLATION AND MAINTENANCE FAMILY                             6              8,251
 28                1  ELECTRICAL INSTALLATION AND MAINTENANCE FAMILY                                       5              8,109
 31                1  FABRIC AND LEATHER WORK FAMILY                                                       4                635
 33                1  INSTRUMENT WORK FAMILY                                                               5                716
 34                1  MACHINE TOOL WORK FAMILY                                                             4              3,550
 35                1  GENERAL SERVICES AND SUPPORT WORK FAMILY                                             5             14,134
 36                1  STRUCTURAL AND FINISHING WORK FAMILY                                                 7                957
 37                1  METAL PROCESSING FAMILY                                                              9              3,785
 38                1  METAL WORK FAMILY                                                                    7              7,234
 39                1  MOTION PICTURE, RADIO, TELEVISION, AND SOUND EQUIPMENT OPERATING FAMILY              2                 20
 40                1  LENS AND CRYSTAL WORK FAMILY                                                         1                124
 41                1  PAINTING AND PAPERHANGING FAMILY                                                     3              3,689
 42                1  PLUMBING AND PIPEFITTING FAMILY                                                      4              4,439
 43                1  PLIABLE MATERIALS WORK FAMILY                                                        4              1,380
 44                1  PRINTING FAMILY                                                                      9              1,000
 46                1  WOOD WORK FAMILY                                                                     6              1,769
 47                1  GENERAL MAINTENANCE AND OPERATIONS WORK FAMILY                                      10             16,340
 48                1  GENERAL EQUIPMENT MAINTENANCE FAMILY                                                 9              1,137
 50                1  PLANT AND ANIMAL WORK FAMILY                                                         7              1,516
 52                1  MISCELLANEOUS OCCUPATIONS FAMILY                                                     5              2,885
 53                1  INDUSTRIAL EQUIPMENT MAINTENANCE FAMILY                                             12              9,980
 54                1  INDUSTRIAL EQUIPMENT OPERATION FAMILY                                               12              4,793
 57                1  TRANSPORTATION/MOBILE EQUIPMENT OPERATION FAMILY                                    15              9,513
 58                1  TRANSPORTATION/MOBILE EQUIPMENT MAINTENANCE FAMILY                                   5             11,948
 65                1  AMMUNITION, EXPLOSIVES, AND TOXIC MATERIALS WORK FAMILY                              4              1,200
 66                1  ARMAMENT WORK FAMILY                                                                 6              1,961
 69                1  WAREHOUSING AND STOCK HANDLING FAMILY                                                9             13,677
 70                1  PACKING AND PROCESSING FAMILY                                                        4                640
 73                1  LAUNDRY, DRY CLEANING, AND PRESSING FAMILY                                           3                818
 74                1  FOOD PREPARATION AND SERVING FAMILY                                                  6             10,706
 76                1  PERSONAL SERVICES FAMILY                                                             2                 66
 82                1  FLUID SYSTEMS MAINTENANCE FAMILY                                                     3              1,426
 86                1  ENGINE OVERHAUL FAMILY                                                               3              1,760
 88                1  AIRCRAFT OVERHAUL FAMILY                                                             5             10,038
 99                1  VESSEL JOBS FAMILY (EXCLUDED FROM THE FEDERAL WAGE SYSTEM)                          55              6,784
                   0                                                                                       0
```

Group codes with more than one published group name (all files)  [query Q3.4]
```
(no rows)
```

Blue collar by code: 4-digit codes 2500 and above vs occupational category, all files  [query Q3.5]
```
dataset      code_2500_plus  occupational_category_code         rows
-----------  --------------  --------------------------  -----------
accessions   false           *                                     8
accessions   false           A                               901,943
accessions   false           C                               497,529
accessions   false           O                               243,892
accessions   false           P                               820,696
accessions   false           T                               775,372
accessions   true            B                               400,181
employment   false           *                                 8,076
employment   false           A                           145,046,663
employment   false           C                            22,994,993
employment   false           O                            14,799,586
employment   false           P                           104,175,973
employment   false           T                            60,526,482
employment   true            B                            33,752,120
separations  false                                           341,537
separations  false           *                                    18
separations  false           A                               915,064
separations  false           C                               326,008
separations  false           O                               169,962
separations  false           P                               651,202
separations  false           T                               722,927
separations  false                                           135,189
separations  true                                             25,133
separations  true            B                               335,450
separations  true                                             15,143
```

Blue collar by pay plan: wage-grade pay plans (code starting W) vs code 2500 and above, Aug 2026 employment and all actions  [query Q3.6]
```
dataset      code_2500_plus  pay_plan_w       rows
-----------  --------------  ----------  ---------
accessions   false           false       3,239,340
accessions   false                             100
accessions   true            false          22,363
accessions   true            true          377,794
accessions   true                               24
employment   false           false       1,856,267
employment   true            false           5,810
employment   true            true          161,482
separations  false           false       3,261,900
separations  false                               7
separations  true            false          20,167
separations  true            true          355,556
separations  true                                3
```

Wage codes (2500+) on pay plans not starting W, Aug 2026 employment: top 15 pay plans  [query Q3.7]
```
pay_plan_code  headcount
-------------  ---------
BB                 1,399
NA                 1,229
XF                   428
CY                   412
XH                   344
XA                   245
KB                   219
CE                   182
KX                   168
KG                   166
KI                   152
BS                   113
AD                   105
BL                   104
FW                    65
```

## 4. Concentration

**Answer.** Government-wide the spread is wide: 582 series had hires and 646 had departures in FY2025; the top 10
cover 32.3% of hires and 33.8% of departures, the top 25 51.3% and 52.1% (Q4.3). Top hires FY2025: 1802 Compliance
Inspection and Support 8,317 (8,243 of them in HS), 0301 8,254, 0303 6,101, 0610 Nurse 5,561, 2210 IT 4,553 (Q4.1a).
Top departures FY2025: 0301 24,530, 0343 18,209, 2210 16,458, 0303 12,288, then the blank code 9,988 (Q4.2a).
Departments are far more concentrated: top 10 share of FY2025 hires HS 87.1%, TR 85.2%, DJ 76.4%, VA 65.2%,
DOD 30.9%; in the latest 12 months TR's 4,289 hires come from 38 series, 98.2% in the top 10 (Q4.3).

Transfers: among the top 10 government-wide, transfers are 5.0% of FY2025 departures (all series 4.4%) and 3.9% of
hires (all series 4.2%); the top 10 hold 26 to 38% of all transfers (Q4.4). Shares vary widely by series: 0201 Human
Resources Management hires are 33.7% transfers in FY2025, 0343 16.6%, 1102 Contracting 16.1% (Q4.1a). A top list
should therefore carry the transfer count per series, as the other pages do.

Top 15 series by hires, FY2025: GOV and the 5 largest departments (Aug 2026 headcount); pct_transfer = share of the series' hires that are transfers (AA, AB)  [query Q4.1a]
```
entity  rnk  series  latest_name                                                            hires  pct_of_total  pct_transfer
------  ---  ------  ---------------------------------------------------------------------  -----  ------------  ------------
DJ        1    0007  CORRECTIONAL OFFICER                                                   1,960         31.45           0.1
DJ        2    0303  MISCELLANEOUS CLERK AND ASSISTANT                                        697         11.18             0
DJ        3    0905  GENERAL ATTORNEY                                                         630         10.11             0
DJ        4    1811  CRIMINAL INVESTIGATION                                                   589          9.45          11.4
DJ        5    0082  UNITED STATES MARSHAL                                                    237           3.8             0
DJ        6    0610  NURSE                                                                    146          2.34             0
DJ        7    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                                 136          2.18          14.7
DJ        8    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES    135          2.17           5.9
DJ        9    0132  INTELLIGENCE                                                             117          1.88             0
DJ       10    2210  INFORMATION TECHNOLOGY MANAGEMENT                                        114          1.83           2.6
DJ       11    0318  SECRETARY                                                                 79          1.27             0
DJ       12    0986  LEGAL ASSISTANCE                                                          77          1.24           3.9
DJ       13    0201  HUMAN RESOURCES MANAGEMENT                                                67          1.08          35.8
DJ       14    0199  SOCIAL SCIENCE STUDENT TRAINEE                                            60          0.96             0
DJ       15    0080  SECURITY ADMINISTRATION                                                   57          0.91            14
DOD       1    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                               2,892          5.86          10.3
DOD       2    2210  INFORMATION TECHNOLOGY MANAGEMENT                                      2,579          5.23           4.1
DOD       3    1701  GENERAL EDUCATION AND TRAINING                                         1,860          3.77           0.3
DOD       4    0343  MANAGEMENT AND PROGRAM ANALYSIS                                        1,617          3.28          14.7
DOD       5    1102  CONTRACTING                                                            1,295          2.62          15.4
DOD       6    0303  MISCELLANEOUS CLERK AND ASSISTANT                                      1,236           2.5           7.7
DOD       7    0201  HUMAN RESOURCES MANAGEMENT                                             1,094          2.22          24.1
DOD       8    1702  EDUCATION AND TRAINING TECHNICIAN                                        914          1.85             1
DOD       9    0083  POLICE                                                                   886           1.8           2.9
DOD      10    1101  GENERAL BUSINESS AND INDUSTRY                                            870          1.76           4.9
DOD      11    0080  SECURITY ADMINISTRATION                                                  846          1.71           9.7
DOD      12    8852  AIRCRAFT MECHANIC                                                        827          1.68             0
DOD      13    0081  FIRE PROTECTION AND PREVENTION                                           784          1.59          11.5
DOD      14    0801  GENERAL ENGINEERING                                                      783          1.59          10.3
DOD      15    0346  LOGISTICS MANAGEMENT                                                     776          1.57           9.9
GOV       1    1802  COMPLIANCE INSPECTION AND SUPPORT                                      8,317          5.44           0.1
GOV       2    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                               8,254           5.4           7.9
GOV       3    0303  MISCELLANEOUS CLERK AND ASSISTANT                                      6,101          3.99           2.2
GOV       4    0610  NURSE                                                                  5,561          3.64           0.2
GOV       5    2210  INFORMATION TECHNOLOGY MANAGEMENT                                      4,553          2.98           5.8
GOV       6    0462  FORESTRY TECHNICIAN                                                    4,028          2.64           0.3
GOV       7    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES  3,588          2.35           3.2
GOV       8    0343  MANAGEMENT AND PROGRAM ANALYSIS                                        3,277          2.14          16.6
GOV       9    1811  CRIMINAL INVESTIGATION                                                 2,818          1.84           5.5
GOV      10    0679  MEDICAL SUPPORT ASSISTANCE                                             2,814          1.84           0.2
GOV      11    0602  MEDICAL OFFICER                                                        2,549          1.67             0
GOV      12    0905  GENERAL ATTORNEY                                                       2,286           1.5           0.4
GOV      13    2152  AIR TRAFFIC CONTROL                                                    2,206          1.44           0.5
GOV      14    1102  CONTRACTING                                                            2,122          1.39          16.1
GOV      15    0201  HUMAN RESOURCES MANAGEMENT                                             2,038          1.33          33.7
HS        1    1802  COMPLIANCE INSPECTION AND SUPPORT                                      8,243         36.12             0
HS        2    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES  2,917         12.78           1.3
HS        3    1811  CRIMINAL INVESTIGATION                                                 1,695          7.43           1.1
HS        4    1896  BORDER PATROL ENFORCEMENT SERIES                                       1,668          7.31             0
HS        5    1895  CUSTOMS AND BORDER PROTECTION                                          1,546          6.78             0
HS        6    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                               1,514          6.64           4.6
HS        7    0089  EMERGENCY MANAGEMENT SPECIALIST                                          987          4.33           0.8
HS        8    0905  GENERAL ATTORNEY                                                         481          2.11           0.2
HS        9    2210  INFORMATION TECHNOLOGY MANAGEMENT                                        425          1.86           6.4
HS       10    0343  MANAGEMENT AND PROGRAM ANALYSIS                                          398          1.74          14.8
HS       11    0083  POLICE                                                                   248          1.09           0.8
HS       12    0201  HUMAN RESOURCES MANAGEMENT                                               184          0.81          39.7
HS       13    0080  SECURITY ADMINISTRATION                                                  113           0.5          14.2
HS       14    1102  CONTRACTING                                                              113           0.5          12.4
HS       15    0132  INTELLIGENCE                                                             112          0.49           2.7
TR        1    0962  CONTACT REPRESENTATIVE                                                 1,712         24.43             0
TR        2    0592  TAX EXAMINING                                                          1,128         16.09             0
TR        3    0512  INTERNAL REVENUE AGENT                                                 1,075         15.34             0
TR        4    0303  MISCELLANEOUS CLERK AND ASSISTANT                                        835         11.91             0
TR        5    2210  INFORMATION TECHNOLOGY MANAGEMENT                                        403          5.75           2.2
TR        6    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                                 265          3.78           7.5
TR        7    0201  HUMAN RESOURCES MANAGEMENT                                               141          2.01          43.3
TR        8    0343  MANAGEMENT AND PROGRAM ANALYSIS                                          138          1.97          31.9
TR        9    1169  INTERNAL REVENUE OFFICER                                                 137          1.95             0
TR       10    1811  CRIMINAL INVESTIGATION                                                   137          1.95           0.7
TR       11    1102  CONTRACTING                                                              102          1.46           4.9
TR       12    0905  GENERAL ATTORNEY                                                          77           1.1             0
TR       13    0503  FINANCIAL CLERICAL AND ASSISTANCE                                         69          0.98           2.9
TR       14    0501  FINANCIAL ADMINISTRATION AND PROGRAM                                      67          0.96             3
TR       15    0801  GENERAL ENGINEERING                                                       49           0.7             0
VA        1    0610  NURSE                                                                  4,253         16.44             0
VA        2    0679  MEDICAL SUPPORT ASSISTANCE                                             2,295          8.87             0
VA        3    0602  MEDICAL OFFICER                                                        2,084          8.06             0
VA        4    0185  SOCIAL WORK                                                            1,718          6.64             0
VA        5    3566  CUSTODIAL WORKING                                                      1,355          5.24           0.1
VA        6    0180  PSYCHOLOGY                                                             1,278          4.94           0.1
VA        7    0621  NURSING ASSISTANT                                                      1,199          4.64             0
VA        8    0660  PHARMACIST                                                               903          3.49             0
VA        9    7408  FOOD SERVICE WORKING                                                     897          3.47             0
VA       10    0620  PRACTICAL NURSE                                                          887          3.43             0
VA       11    0640  HEALTH AID AND TECHNICIAN                                                565          2.18           0.9
VA       12    0601  GENERAL HEALTH SCIENCE                                                   408          1.58             0
VA       13    0661  PHARMACY TECHNICIAN                                                      371          1.43             0
VA       14    0083  POLICE                                                                   320          1.24           2.5
VA       15    0680  DENTAL OFFICER                                                           302          1.17             0
```

Top 15 series by hires, latest 12 months (Sep 2025 to Aug 2026): GOV and the 5 largest departments (Aug 2026 headcount); pct_transfer = share of the series' hires that are transfers (AA, AB)  [query Q4.1b]
```
entity  rnk  series  latest_name                                                            hires  pct_of_total  pct_transfer
------  ---  ------  ---------------------------------------------------------------------  -----  ------------  ------------
DJ        1    0007  CORRECTIONAL OFFICER                                                   2,125         24.62             0
DJ        2    0905  GENERAL ATTORNEY                                                       1,508         17.47             0
DJ        3    1811  CRIMINAL INVESTIGATION                                                   989         11.46           5.2
DJ        4    0303  MISCELLANEOUS CLERK AND ASSISTANT                                        976         11.31           0.1
DJ        5    0610  NURSE                                                                    242           2.8             0
DJ        6    0082  UNITED STATES MARSHAL                                                    232          2.69             0
DJ        7    0901  GENERAL LEGAL AND KINDRED ADMINISTRATION                                 197          2.28           9.1
DJ        8    0986  LEGAL ASSISTANCE                                                         176          2.04           3.4
DJ        9    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES    174          2.02           1.7
DJ       10    2210  INFORMATION TECHNOLOGY MANAGEMENT                                        165          1.91           6.1
DJ       11    0950  PARALEGAL SPECIALIST                                                     158          1.83             7
DJ       12    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                                 149          1.73           5.4
DJ       13    0963  LEGAL INSTRUMENTS EXAMINING                                               97          1.12             0
DJ       14    0318  SECRETARY                                                                 90          1.04           1.1
DJ       15    0201  HUMAN RESOURCES MANAGEMENT                                                84          0.97          22.6
DOD       1    2210  INFORMATION TECHNOLOGY MANAGEMENT                                      2,153          4.98           4.3
DOD       2    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                               1,902           4.4           8.2
DOD       3    1701  GENERAL EDUCATION AND TRAINING                                         1,669          3.86           0.5
DOD       4    0343  MANAGEMENT AND PROGRAM ANALYSIS                                        1,145          2.65          14.5
DOD       5    1102  CONTRACTING                                                            1,122           2.6           9.8
DOD       6    8852  AIRCRAFT MECHANIC                                                      1,013          2.34             0
DOD       7    1101  GENERAL BUSINESS AND INDUSTRY                                            957          2.21             3
DOD       8    1702  EDUCATION AND TRAINING TECHNICIAN                                        929          2.15           0.3
DOD       9    0303  MISCELLANEOUS CLERK AND ASSISTANT                                        783          1.81           2.8
DOD      10    0081  FIRE PROTECTION AND PREVENTION                                           776           1.8           8.5
DOD      11    0083  POLICE                                                                   756          1.75           1.5
DOD      12    5801  MISC TRANSPORTATION/MOBILE EQUIPMT MAINTNE                               734           1.7           0.3
DOD      13    0201  HUMAN RESOURCES MANAGEMENT                                               713          1.65          14.7
DOD      14    0610  NURSE                                                                    688          1.59           0.7
DOD      15    0080  SECURITY ADMINISTRATION                                                  676          1.56           7.8
GOV       1    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES  8,524          5.31           1.3
GOV       2    0610  NURSE                                                                  8,369          5.22           0.1
GOV       3    0303  MISCELLANEOUS CLERK AND ASSISTANT                                      5,779           3.6           0.8
GOV       4    0456  WILDLAND FIRE MANAGEMENT                                               5,213          3.25           0.1
GOV       5    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                               4,775          2.98           5.6
GOV       6    1811  CRIMINAL INVESTIGATION                                                 4,704          2.93             5
GOV       7    0679  MEDICAL SUPPORT ASSISTANCE                                             4,637          2.89             0
GOV       8    1896  BORDER PATROL ENFORCEMENT SERIES                                       4,169           2.6             0
GOV       9    2210  INFORMATION TECHNOLOGY MANAGEMENT                                      3,865          2.41           4.5
GOV      10    0905  GENERAL ATTORNEY                                                       3,765          2.35           0.3
GOV      11    0962  CONTACT REPRESENTATIVE                                                 3,248          2.02           0.1
GOV      12    1802  COMPLIANCE INSPECTION AND SUPPORT                                      2,905          1.81           0.4
GOV      13    0602  MEDICAL OFFICER                                                        2,640          1.65           0.1
GOV      14    0185  SOCIAL WORK                                                            2,535          1.58           0.3
GOV      15    2152  AIR TRAFFIC CONTROL                                                    2,474          1.54           0.2
HS        1    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES  7,767         30.59           0.6
HS        2    1896  BORDER PATROL ENFORCEMENT SERIES                                       4,169         16.42             0
HS        3    1811  CRIMINAL INVESTIGATION                                                 3,205         12.62           1.8
HS        4    1802  COMPLIANCE INSPECTION AND SUPPORT                                      2,870          11.3           0.3
HS        5    1895  CUSTOMS AND BORDER PROTECTION                                          2,456          9.67             0
HS        6    0905  GENERAL ATTORNEY                                                       1,214          4.78           0.1
HS        7    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                                 429          1.69           9.1
HS        8    0083  POLICE                                                                   418          1.65           0.2
HS        9    0089  EMERGENCY MANAGEMENT SPECIALIST                                          327          1.29           0.6
HS       10    2210  INFORMATION TECHNOLOGY MANAGEMENT                                        219          0.86          11.9
HS       11    0201  HUMAN RESOURCES MANAGEMENT                                               180          0.71          11.1
HS       12    0343  MANAGEMENT AND PROGRAM ANALYSIS                                          158          0.62          10.1
HS       13    0080  SECURITY ADMINISTRATION                                                  157          0.62          12.7
HS       14    0901  GENERAL LEGAL AND KINDRED ADMINISTRATION                                 142          0.56             0
HS       15    1102  CONTRACTING                                                              112          0.44          11.6
TR        1    0962  CONTACT REPRESENTATIVE                                                 2,272         52.97             0
TR        2    0592  TAX EXAMINING                                                            823         19.19             0
TR        3    0303  MISCELLANEOUS CLERK AND ASSISTANT                                        565         13.17             0
TR        4    2210  INFORMATION TECHNOLOGY MANAGEMENT                                        277          6.46             0
TR        5    0301  MISCELLANEOUS ADMINISTRATION AND PROGRAM                                 107          2.49             0
TR        6    1811  CRIMINAL INVESTIGATION                                                    87          2.03           3.4
TR        7    0905  GENERAL ATTORNEY                                                          41          0.96             0
TR        8    0132  INTELLIGENCE                                                              16          0.37             0
TR        9    0854  COMPUTER ENGINEERING                                                      12          0.28             0
TR       10    0083  POLICE                                                                    10          0.23            50
TR       11    1801  GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES      9          0.21          11.1
TR       12    0110  ECONOMIST                                                                  8          0.19             0
TR       13    6941  BULK MONEY HANDLING                                                        7          0.16             0
TR       14    0201  HUMAN RESOURCES MANAGEMENT                                                 6          0.14          66.7
TR       15    0343  MANAGEMENT AND PROGRAM ANALYSIS                                            4          0.09             0
VA        1    0610  NURSE                                                                  7,190         18.61             0
VA        2    0679  MEDICAL SUPPORT ASSISTANCE                                             4,075         10.55             0
VA        3    0185  SOCIAL WORK                                                            2,311          5.98             0
VA        4    0602  MEDICAL OFFICER                                                        2,293          5.93             0
VA        5    3566  CUSTODIAL WORKING                                                      2,147          5.56           0.1
VA        6    0621  NURSING ASSISTANT                                                      1,937          5.01             0
VA        7    0620  PRACTICAL NURSE                                                        1,421          3.68           0.1
VA        8    7408  FOOD SERVICE WORKING                                                   1,399          3.62           0.1
VA        9    0180  PSYCHOLOGY                                                             1,388          3.59             0
VA       10    0660  PHARMACIST                                                             1,210          3.13             0
VA       11    0640  HEALTH AID AND TECHNICIAN                                                734           1.9           0.8
VA       12    0601  GENERAL HEALTH SCIENCE                                                   668          1.73             0
VA       13    0661  PHARMACY TECHNICIAN                                                      514          1.33             0
VA       14    0101  SOCIAL SCIENCE                                                           482          1.25           1.9
VA       15    2005  SUPPLY CLERICAL AND TECHNICIAN                                           470          1.22           3.6
```

Top 15 series by departures, FY2025: GOV and the 5 largest departments (Aug 2026 headcount); pct_transfer = share of the series' departures that are transfers (SA, SB)  [query Q4.2a]
```
entity  rnk  series  latest_name                                                            departures  pct_of_total  pct_transfer
------  ---  ------  ---------------------------------------------------------------------  ----------  ------------  ------------
DJ        1  0905    GENERAL ATTORNEY                                                            3,105         20.97           5.2
DJ        2  1811    CRIMINAL INVESTIGATION                                                      1,899         12.83           3.1
DJ        3  0007    CORRECTIONAL OFFICER                                                        1,723         11.64           8.7
DJ        4  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                      776          5.24           4.6
DJ        5  0343    MANAGEMENT AND PROGRAM ANALYSIS                                               570          3.85           6.1
DJ        6  0303    MISCELLANEOUS CLERK AND ASSISTANT                                             501          3.38             5
DJ        7  0950    PARALEGAL SPECIALIST                                                          458          3.09           4.1
DJ        8  2210    INFORMATION TECHNOLOGY MANAGEMENT                                             405          2.74           6.2
DJ        9  0132    INTELLIGENCE                                                                  342          2.31           3.8
DJ       10  1801    GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES         341           2.3           8.2
DJ       11  0986    LEGAL ASSISTANCE                                                              279          1.88           9.3
DJ       12  0006    CORRECTIONAL INSTITUTION ADMINISTRATION                                       267           1.8             3
DJ       13  0610    NURSE                                                                         228          1.54           4.4
DJ       14  0101    SOCIAL SCIENCE                                                                212          1.43           2.8
DJ       15  0901    GENERAL LEGAL AND KINDRED ADMINISTRATION                                      206          1.39          12.1
DOD       1  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                    7,389           6.7           7.2
DOD       2  2210    INFORMATION TECHNOLOGY MANAGEMENT                                           6,415          5.81           7.4
DOD       3  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             5,079           4.6           8.1
DOD       4  1102    CONTRACTING                                                                 3,799          3.44          13.8
DOD       5          NO DATA REPORTED                                                            3,480          3.15           2.8
DOD       6  0801    GENERAL ENGINEERING                                                         2,732          2.48           6.7
DOD       7  0346    LOGISTICS MANAGEMENT                                                        2,684          2.43           4.7
DOD       8  0201    HUMAN RESOURCES MANAGEMENT                                                  2,672          2.42          11.9
DOD       9  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           2,566          2.33           7.6
DOD      10  1101    GENERAL BUSINESS AND INDUSTRY                                               2,379          2.16           5.6
DOD      11  0501    FINANCIAL ADMINISTRATION AND PROGRAM                                        2,198          1.99           8.4
DOD      12  0080    SECURITY ADMINISTRATION                                                     1,699          1.54          12.2
DOD      13  0855    ELECTRONICS ENGINEERING                                                     1,554          1.41           3.2
DOD      14  1701    GENERAL EDUCATION AND TRAINING                                              1,421          1.29           3.2
DOD      15  0830    MECHANICAL ENGINEERING                                                      1,356          1.23           3.6
GOV       1  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                   24,530          6.64           5.2
GOV       2  0343    MANAGEMENT AND PROGRAM ANALYSIS                                            18,209          4.93           4.8
GOV       3  2210    INFORMATION TECHNOLOGY MANAGEMENT                                          16,458          4.46           5.2
GOV       4  0303    MISCELLANEOUS CLERK AND ASSISTANT                                          12,288          3.33           3.2
GOV       5          NO DATA REPORTED                                                            9,988          2.71           2.2
GOV       6  0610    NURSE                                                                       9,841          2.67           1.6
GOV       7  0962    CONTACT REPRESENTATIVE                                                      9,383          2.54           1.3
GOV       8  0905    GENERAL ATTORNEY                                                            9,223           2.5           6.4
GOV       9  1102    CONTRACTING                                                                 7,523          2.04          11.6
GOV      10  0201    HUMAN RESOURCES MANAGEMENT                                                  7,287          1.97          11.2
GOV      11  1802    COMPLIANCE INSPECTION AND SUPPORT                                           6,727          1.82           2.3
GOV      12  1101    GENERAL BUSINESS AND INDUSTRY                                               6,618          1.79           3.8
GOV      13  0462    FORESTRY TECHNICIAN                                                         5,181           1.4           3.4
GOV      14  0501    FINANCIAL ADMINISTRATION AND PROGRAM                                        5,147          1.39           5.2
GOV      15  0592    TAX EXAMINING                                                               4,846          1.31           0.8
HS        1  1802    COMPLIANCE INSPECTION AND SUPPORT                                           6,419         27.24           2.1
HS        2  1801    GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES       2,459         10.43           2.8
HS        3  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                    2,425         10.29             3
HS        4  0089    EMERGENCY MANAGEMENT SPECIALIST                                             1,462           6.2           1.4
HS        5  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             1,299          5.51           6.5
HS        6  1811    CRIMINAL INVESTIGATION                                                      1,019          4.32          12.6
HS        7  1895    CUSTOMS AND BORDER PROTECTION                                                 885          3.76           3.3
HS        8  1896    BORDER PATROL ENFORCEMENT SERIES                                              879          3.73           2.4
HS        9  2210    INFORMATION TECHNOLOGY MANAGEMENT                                             776          3.29           5.9
HS       10          NO DATA REPORTED                                                              614          2.61           6.8
HS       11  0905    GENERAL ATTORNEY                                                              447           1.9          10.7
HS       12  0340    PROGRAM MANAGEMENT                                                            314          1.33           5.1
HS       13  0201    HUMAN RESOURCES MANAGEMENT                                                    288          1.22          19.1
HS       14  0080    SECURITY ADMINISTRATION                                                       226          0.96          10.6
HS       15  1102    CONTRACTING                                                                   199          0.84          13.1
TR        1  0962    CONTACT REPRESENTATIVE                                                      7,363          20.9           0.9
TR        2  0592    TAX EXAMINING                                                               4,846         13.76           0.8
TR        3  0512    INTERNAL REVENUE AGENT                                                      3,769          10.7           0.3
TR        4          NO DATA REPORTED                                                            2,517          7.14           0.4
TR        5  2210    INFORMATION TECHNOLOGY MANAGEMENT                                           2,226          6.32             1
TR        6  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           2,198          6.24           0.8
TR        7  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             1,491          4.23           1.4
TR        8  0501    FINANCIAL ADMINISTRATION AND PROGRAM                                        1,338           3.8           0.7
TR        9  1169    INTERNAL REVENUE OFFICER                                                    1,182          3.36           1.3
TR       10  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                      911          2.59           3.8
TR       11  0201    HUMAN RESOURCES MANAGEMENT                                                    668           1.9           4.2
TR       12  0503    FINANCIAL CLERICAL AND ASSISTANCE                                             630          1.79           0.6
TR       13  0905    GENERAL ATTORNEY                                                              472          1.34           2.1
TR       14  0570    FINANCIAL INSTITUTION EXAMINING                                               469          1.33           0.2
TR       15  0930    HEARINGS AND APPEALS                                                          311          0.88           0.3
VA        1  0610    NURSE                                                                       7,716         14.51           0.6
VA        2  0679    MEDICAL SUPPORT ASSISTANCE                                                  3,641          6.85           2.6
VA        3  0602    MEDICAL OFFICER                                                             2,958          5.56           0.4
VA        4  0185    SOCIAL WORK                                                                 2,391           4.5           1.8
VA        5  3566    CUSTODIAL WORKING                                                           2,027          3.81           0.8
VA        6  0996    VETERANS CLAIMS EXAMINING                                                   1,851          3.48           2.4
VA        7  0621    NURSING ASSISTANT                                                           1,564          2.94           0.4
VA        8  0620    PRACTICAL NURSE                                                             1,537          2.89           1.1
VA        9  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           1,489           2.8             5
VA       10  0180    PSYCHOLOGY                                                                  1,460          2.75           0.6
VA       11  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             1,401          2.63           3.6
VA       12  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                    1,251          2.35           3.8
VA       13  0201    HUMAN RESOURCES MANAGEMENT                                                  1,234          2.32           3.9
VA       14  0660    PHARMACIST                                                                    935          1.76           0.7
VA       15  7408    FOOD SERVICE WORKING                                                          930          1.75           0.9
```

Top 15 series by departures, latest 12 months (Sep 2025 to Aug 2026): GOV and the 5 largest departments (Aug 2026 headcount); pct_transfer = share of the series' departures that are transfers (SA, SB)  [query Q4.2b]
```
entity  rnk  series  latest_name                                                            departures  pct_of_total  pct_transfer
------  ---  ------  ---------------------------------------------------------------------  ----------  ------------  ------------
DJ        1  0905    GENERAL ATTORNEY                                                            2,469         17.94           8.1
DJ        2  1811    CRIMINAL INVESTIGATION                                                      1,921         13.95           4.2
DJ        3  0007    CORRECTIONAL OFFICER                                                        1,904         13.83          16.1
DJ        4  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                      676          4.91           3.3
DJ        5  0343    MANAGEMENT AND PROGRAM ANALYSIS                                               495           3.6           2.6
DJ        6  0303    MISCELLANEOUS CLERK AND ASSISTANT                                             474          3.44           5.7
DJ        7  2210    INFORMATION TECHNOLOGY MANAGEMENT                                             403          2.93             4
DJ        8  1801    GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES         395          2.87          10.1
DJ        9  0132    INTELLIGENCE                                                                  372           2.7           4.3
DJ       10  0950    PARALEGAL SPECIALIST                                                          370          2.69           5.7
DJ       11  0986    LEGAL ASSISTANCE                                                              262           1.9            16
DJ       12  0006    CORRECTIONAL INSTITUTION ADMINISTRATION                                       227          1.65           3.1
DJ       13  0101    SOCIAL SCIENCE                                                                218          1.58           6.9
DJ       14  0901    GENERAL LEGAL AND KINDRED ADMINISTRATION                                      206           1.5          11.7
DJ       15  0610    NURSE                                                                         200          1.45           9.5
DOD       1  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                    8,124          7.76           3.8
DOD       2  2210    INFORMATION TECHNOLOGY MANAGEMENT                                           6,384           6.1           4.2
DOD       3  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             5,362          5.12           4.1
DOD       4  1102    CONTRACTING                                                                 3,350           3.2           4.7
DOD       5          NO DATA REPORTED                                                            3,319          3.17           1.1
DOD       6  0346    LOGISTICS MANAGEMENT                                                        2,980          2.85           3.1
DOD       7  0801    GENERAL ENGINEERING                                                         2,915          2.79           3.2
DOD       8  0201    HUMAN RESOURCES MANAGEMENT                                                  2,483          2.37             5
DOD       9  1101    GENERAL BUSINESS AND INDUSTRY                                               2,269          2.17           2.2
DOD      10  0501    FINANCIAL ADMINISTRATION AND PROGRAM                                        2,171          2.07           3.5
DOD      11  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           2,127          2.03           3.7
DOD      12  0080    SECURITY ADMINISTRATION                                                     1,682          1.61           7.4
DOD      13  0855    ELECTRONICS ENGINEERING                                                     1,675           1.6           1.2
DOD      14  1701    GENERAL EDUCATION AND TRAINING                                              1,466           1.4           1.6
DOD      15  0830    MECHANICAL ENGINEERING                                                      1,453          1.39           1.6
GOV       1  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                   19,987          6.06           3.7
GOV       2  0343    MANAGEMENT AND PROGRAM ANALYSIS                                            15,850          4.81           2.8
GOV       3  2210    INFORMATION TECHNOLOGY MANAGEMENT                                          15,467          4.69           3.1
GOV       4  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           9,995          3.03           1.9
GOV       5          NO DATA REPORTED                                                            8,642          2.62           1.4
GOV       6  0610    NURSE                                                                       8,440          2.56           2.5
GOV       7  0962    CONTACT REPRESENTATIVE                                                      8,005          2.43           1.5
GOV       8  0905    GENERAL ATTORNEY                                                            7,737          2.35          10.1
GOV       9  0201    HUMAN RESOURCES MANAGEMENT                                                  6,828          2.07           4.7
GOV      10  1801    GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES       6,640          2.01           3.5
GOV      11  1802    COMPLIANCE INSPECTION AND SUPPORT                                           6,640          2.01           2.7
GOV      12  1101    GENERAL BUSINESS AND INDUSTRY                                               6,414          1.95           1.6
GOV      13  1102    CONTRACTING                                                                 6,368          1.93             5
GOV      14  0801    GENERAL ENGINEERING                                                         5,161          1.57           3.1
GOV      15  0501    FINANCIAL ADMINISTRATION AND PROGRAM                                        4,879          1.48           2.6
HS        1  1802    COMPLIANCE INSPECTION AND SUPPORT                                           6,338         23.11           2.6
HS        2  1801    GENERAL INSPECTION, INVESTIGATION, ENFORCEMENT, AND COMPLIANCE SERIES       4,890         17.83             2
HS        3  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                    1,980          7.22           3.7
HS        4  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             1,769          6.45           3.4
HS        5  0089    EMERGENCY MANAGEMENT SPECIALIST                                             1,532          5.59           1.1
HS        6  1811    CRIMINAL INVESTIGATION                                                      1,152           4.2          12.5
HS        7  1896    BORDER PATROL ENFORCEMENT SERIES                                            1,043           3.8           2.5
HS        8  1895    CUSTOMS AND BORDER PROTECTION                                                 954          3.48           2.6
HS        9  2210    INFORMATION TECHNOLOGY MANAGEMENT                                             939          3.42           4.9
HS       10  0905    GENERAL ATTORNEY                                                              758          2.76          24.1
HS       11          NO DATA REPORTED                                                              738          2.69           3.4
HS       12  0340    PROGRAM MANAGEMENT                                                            372          1.36           4.8
HS       13  0201    HUMAN RESOURCES MANAGEMENT                                                    334          1.22           7.2
HS       14  0132    INTELLIGENCE                                                                  313          1.14           8.3
HS       15  0080    SECURITY ADMINISTRATION                                                       268          0.98           7.8
TR        1  0962    CONTACT REPRESENTATIVE                                                      6,594         21.91             1
TR        2  0592    TAX EXAMINING                                                               4,123          13.7           0.5
TR        3  0512    INTERNAL REVENUE AGENT                                                      2,761          9.18           0.4
TR        4  2210    INFORMATION TECHNOLOGY MANAGEMENT                                           2,109          7.01           1.4
TR        5          NO DATA REPORTED                                                            1,932          6.42           0.6
TR        6  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           1,927           6.4           0.9
TR        7  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             1,308          4.35           1.1
TR        8  1169    INTERNAL REVENUE OFFICER                                                    1,105          3.67           1.6
TR        9  0501    FINANCIAL ADMINISTRATION AND PROGRAM                                        1,095          3.64           1.2
TR       10  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                      775          2.58           2.1
TR       11  0201    HUMAN RESOURCES MANAGEMENT                                                    656          2.18           3.7
TR       12  0503    FINANCIAL CLERICAL AND ASSISTANCE                                             475          1.58           0.8
TR       13  0905    GENERAL ATTORNEY                                                              421           1.4           7.1
TR       14  0570    FINANCIAL INSTITUTION EXAMINING                                               393          1.31             1
TR       15  0340    PROGRAM MANAGEMENT                                                            278          0.92           0.7
VA        1  0610    NURSE                                                                       6,702         13.93           0.9
VA        2  0679    MEDICAL SUPPORT ASSISTANCE                                                  3,496          7.27           2.5
VA        3  0602    MEDICAL OFFICER                                                             2,826          5.88           0.5
VA        4  0185    SOCIAL WORK                                                                 2,083          4.33           1.7
VA        5  3566    CUSTODIAL WORKING                                                           2,074          4.31           0.2
VA        6  0621    NURSING ASSISTANT                                                           1,533          3.19           0.5
VA        7  0180    PSYCHOLOGY                                                                  1,381          2.87           0.7
VA        8  0996    VETERANS CLAIMS EXAMINING                                                   1,338          2.78           3.1
VA        9  0620    PRACTICAL NURSE                                                             1,323          2.75           0.8
VA       10  0201    HUMAN RESOURCES MANAGEMENT                                                  1,280          2.66           2.5
VA       11  0343    MANAGEMENT AND PROGRAM ANALYSIS                                             1,175          2.44             2
VA       12  0303    MISCELLANEOUS CLERK AND ASSISTANT                                           1,173          2.44           2.3
VA       13  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM                                    1,114          2.32           2.8
VA       14  7408    FOOD SERVICE WORKING                                                          998          2.07           0.8
VA       15  0660    PHARMACIST                                                                    949          1.97           0.6
```

Share of all hires and departures covered by the top 10 and top 25 series (by that flow), GOV and the 5 largest departments, FY2025 and the latest 12 months  [query Q4.3]
```
win     flow        entity    total  series_with_events  pct_top10  pct_top25
------  ----------  ------  -------  ------------------  ---------  ---------
FY2025  departures  GOV     369,153                 646       33.8       52.1
FY2025  departures  DOD     110,362                 526       35.5         54
FY2025  departures  VA       53,177                 271       50.1       72.5
FY2025  departures  TR       35,229                 157         79       92.8
FY2025  departures  HS       23,568                 210       77.4         89
FY2025  departures  DJ       14,806                 177       68.4       85.3
FY2025  hires       GOV     152,831                 582       32.3       51.3
FY2025  hires       DOD      49,344                 473       30.9         52
FY2025  hires       VA       25,868                 191       65.2       82.5
FY2025  hires       HS       22,818                 183       87.1       94.3
FY2025  hires       TR        7,009                 104       85.2       94.4
FY2025  hires       DJ        6,232                 126       76.4       88.7
t12     departures  GOV     329,623                 638       32.6       52.6
t12     departures  DOD     104,640                 525       37.6       56.8
t12     departures  VA       48,100                 254         50         73
t12     departures  TR       30,092                 153       78.9       92.7
t12     departures  HS       27,425                 215       77.9       90.1
t12     departures  DJ       13,766                 176       68.9       85.5
t12     hires       GOV     160,466                 553       33.5       54.7
t12     hires       DOD      43,222                 436       28.8       49.8
t12     hires       VA       38,636                 200       65.7       82.5
t12     hires       HS       25,394                 149       90.9       96.5
t12     hires       DJ        8,630                 120       78.6       91.3
t12     hires       TR        4,289                  38       98.2       99.6
```

Transfer share of the top 10 series government-wide (hires: AA, AB; departures: SA, SB) against the all-series transfer share  [query Q4.4]
```
win     flow        top10_events  top10_transfers  pct_transfer_top10  pct_transfer_all_series  top10_pct_of_all_transfers
------  ----------  ------------  ---------------  ------------------  -----------------------  --------------------------
FY2025  departures       124,730            6,180                   5                      4.4                        37.8
FY2025  hires             49,311            1,908                 3.9                      4.2                        30.1
t12     departures       107,591            3,648                 3.4                      3.3                        33.1
t12     hires             53,800              852                 1.6                        2                        26.3
```

## 5. Cell sizes

**Answer.** At government level most series cells are usable: FY2025 departures 646 cells, 128 (19.8%) under 10 and
220 (34.1%) under 30; hires 582 cells, 28.4% under 10 and 47.1% under 30 (Q5.2). At department level small cells
dominate at every grain: FY2025 departures 4,654 cells, 59.4% under 10 and 76.0% under 30; hires 3,065 cells, 67.0%
and 83.2% (Q5.2); at fy and t12 grain over all years 63 to 64% under 10 and 80% under 30, admin grain 54 to 61% under 10 (Q5.1). Subelement level is 72 to
82% under 10 in the latest periods (Q5.4). For rates, 66.5% of department-series cells in FY2025 have an average headcount below 30 or of
0 (4,447 small base, 44 zero) against 11.9% at government level (Q5.5). Since the Look-Up already publishes every row
with its series and department, small cells disclose nothing new; the issue is noise and a page full of small-base
flags, not privacy.

(entity, period, series) cells with at least one event, GOV and departments, by grain (fy FY2012 to FY2026; t12 = all 168 trailing windows as the breakdown cubes; admin and admin_n 4 each)  [query Q5.1]
```
level       flow        grain    cells_with_events     lt10     lt30  pct_lt10  pct_lt30
----------  ----------  -------  -----------------  -------  -------  --------  --------
department  departures  admin               22,417   12,376   16,157      55.2      72.1
department  departures  admin_n             19,202   11,448   14,671      59.6      76.4
department  departures  fy                  62,708   40,363   50,290      64.4      80.2
department  departures  t12                704,590  452,308  563,853      64.2        80
department  hires       admin               18,964   10,263   13,529      54.1      71.3
department  hires       admin_n             15,390    9,330   11,919      60.6      77.4
department  hires       fy                  54,315   34,227   43,209        63      79.6
department  hires       t12                611,598  384,628  485,450      62.9      79.4
gov         departures  admin                2,683      299      650      11.1      24.2
gov         departures  admin_n              2,648      438      849      16.5      32.1
gov         departures  fy                   9,743    2,214    3,849      22.7      39.5
gov         departures  t12                109,213   24,632   42,970      22.6      39.3
gov         hires       admin                2,529      363      706      14.4      27.9
gov         hires       admin_n              2,429      517      866      21.3      35.7
gov         hires       fy                   9,023    2,108    3,581      23.4      39.7
gov         hires       t12                101,013   23,291   39,859      23.1      39.5
```

Same, latest periods only: FY2025, t12 to Aug 2026, admin trump2  [query Q5.2]
```
level       flow        grain         cells_with_events   lt10   lt30  pct_lt10  pct_lt30
----------  ----------  ------------  -----------------  -----  -----  --------  --------
department  departures  admin trump2              5,029  2,881  3,730      57.3      74.2
department  departures  fy FY2025                 4,654  2,765  3,536      59.4        76
department  departures  t12 2026-08               4,446  2,666  3,436        60      77.3
department  hires       admin trump2              2,972  1,885  2,370      63.4      79.7
department  hires       fy FY2025                 3,065  2,054  2,549        67      83.2
department  hires       t12 2026-08               2,372  1,536  1,916      64.8      80.8
gov         departures  admin trump2                654    102    203      15.6        31
gov         departures  fy FY2025                   646    128    220      19.8      34.1
gov         departures  t12 2026-08                 638    129    227      20.2      35.6
gov         hires       admin trump2                588    153    259        26        44
gov         hires       fy FY2025                   582    165    274      28.4      47.1
gov         hires       t12 2026-08                 553    166    272        30      49.2
```

Same at agency (the 4 DOD agencies; every other agency equals its department) and subelement level, all grains  [query Q5.3]
```
level       flow        grain    cells_with_events       lt10       lt30  pct_lt10  pct_lt30
----------  ----------  -------  -----------------  ---------  ---------  --------  --------
agency      departures  admin                6,476      2,301      3,518      35.5      54.3
agency      departures  admin_n              6,040      2,558      3,805      42.4        63
agency      departures  fy                  21,069     10,249     14,603      48.6      69.3
agency      departures  t12                237,293    114,849    163,998      48.4      69.1
agency      hires       admin                5,931      2,065      3,195      34.8      53.9
agency      hires       admin_n              5,343      2,306      3,413      43.2      63.9
agency      hires       fy                  19,332      9,140     13,006      47.3      67.3
agency      hires       t12                217,826    102,891    146,013      47.2        67
subelement  departures  admin               84,357     57,838     71,339      68.6      84.6
subelement  departures  admin_n             67,976     50,215     60,142      73.9      88.5
subelement  departures  fy                 211,598    165,999    193,558      78.5      91.5
subelement  departures  t12              2,386,386  1,869,523  2,181,514      78.3      91.4
subelement  hires       admin               69,905     46,828     58,470        67      83.6
subelement  hires       admin_n             51,887     38,827     46,274      74.8      89.2
subelement  hires       fy                 179,564    139,055    163,341      77.4        91
subelement  hires       t12              2,033,309  1,571,438  1,848,271      77.3      90.9
```

Agency and subelement level, latest periods only  [query Q5.4]
```
level       flow        grain         cells_with_events    lt10    lt30  pct_lt10  pct_lt30
----------  ----------  ------------  -----------------  ------  ------  --------  --------
agency      departures  admin trump2              1,429     601     910      42.1      63.7
agency      departures  fy FY2025                 1,383     655     924      47.4      66.8
agency      departures  t12 2026-08               1,355     646     920      47.7      67.9
agency      hires       admin trump2              1,152     550     793      47.7      68.8
agency      hires       fy FY2025                 1,169     631     864        54      73.9
agency      hires       t12 2026-08               1,022     551     753      53.9      73.7
subelement  departures  admin trump2             17,863  12,811  15,520      71.7      86.9
subelement  departures  fy FY2025                16,186  11,993  14,311      74.1      88.4
subelement  departures  t12 2026-08              15,656  11,763  13,964      75.1      89.2
subelement  hires       admin trump2              9,495   7,427   8,612      78.2      90.7
subelement  hires       fy FY2025                 9,727   7,966   9,051      81.9      93.1
subelement  hires       t12 2026-08               6,969   5,519   6,359      79.2      91.2
```

Rates by series: (entity, series) cells with events or headcount, and how many have an average month-end headcount below 30 (small-base flag) or of 0 (rate left empty), FY2025 and t12 to Aug 2026  [query Q5.5]
```
window       level       cells  avg_headcount_0  small_base  pct_empty_or_small
-----------  ----------  -----  ---------------  ----------  ------------------
fy FY2025    gov           674                4          76                11.9
fy FY2025    department  6,756               44       4,447                66.5
t12 2026-08  gov           671                2          84                12.8
t12 2026-08  department  6,501               65       4,372                68.3
```

## 6. Size estimates

**Answer.** Sizes are the summed byte length of each row as compact JSON (the cube writer's convention), plus a small
per-file header; they are estimates within a few percent. For scale: all cubes today are 236.5 MB and the per-file cap
is 3 MB. A: top 25 plus "other" is 23.0 MB with every t12 window as the breakdown cubes have (GOV 0.40 MB), or 2.98 MB
with only the latest t12 window (Q6.1, Q6.2). B: every series is 87.9 MB with every t12 window and 8 files over the
3 MB cap (GOV 7.05 MB), or 11.0 MB with only the latest t12 window (GOV 0.88 MB, none over the cap) (Q6.3, Q6.4).
C: monthly by series is 3.4 MB for GOV (over the cap; 1.33 MB from Oct 2020), 30.9 MB for the 141 departments
(largest DOD 2.88 MB) and 8.3 MB for the 4 DOD agencies, about 42.6 MB in all; by family it is 8.5 MB in all with
GOV 0.32 MB (Q6.5, Q6.6, Q6.8). Subelement by series would add 119.8 MB in 653 files (largest AF1M 1.58 MB) (Q6.7).
D: the Look-Up already has the series on every action row, but its files are split by fiscal year, not by series:
one series over all years means loading all 32 action files, 43.1 MB, and the employment files hold only the latest
month (125 files, 8.0 MB), so D gives no headcount history at all (Q6.9).

Option A: top 25 series by hires and by departures plus "other", per GOV, department and DOD agency (one file each; 145 have actions), fy, all t12 windows, admin and admin_n; row ["t12","2026-08","hires","0610",1234]  [query Q6.1]
```
files     rows  mb  largest_file_mb  largest_entity
-----  -------  --  ---------------  --------------
  145  600,576  23            0.404  GOV
```

Option A with only the latest t12 window (fy, t12 2026-08, admin, admin_n)  [query Q6.2]
```
files    rows    mb  largest_file_mb  largest_entity
-----  ------  ----  ---------------  --------------
  145  78,280  2.98             0.05  GOV
```

Option B: every series per GOV, department and DOD agency, fy, all t12 windows, admin, admin_n; row [grain, period, series, hires, departures, transfer in, transfer out, headcount at period end, average headcount, small-base flag]  [query Q6.3]
```
files       rows    mb  largest_file_mb  largest_entity  files_over_3mb_cap
-----  ---------  ----  ---------------  --------------  ------------------
  146  1,798,597  87.9             7.05  GOV                              8
```

Option B with only the latest t12 window  [query Q6.4]
```
files     rows  mb  largest_file_mb  largest_entity  files_over_3mb_cap
-----  -------  --  ---------------  --------------  ------------------
  146  226,700  11             0.88  GOV                              0
```

Option C by series: monthly [month, series, headcount, hires, departures] per entity file, Oct 2011 to Aug 2026  [query Q6.5]
```
level       files       rows    mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  ---------  ----  ---------------  --------------  ------------------
agency          4    314,955   8.3             2.44  DOD-NV                           0
department    141  1,193,530  30.9             2.88  DOD                              0
gov             1    121,286   3.4             3.39  GOV                              1
```

Option C by family (first two digits of a 4-digit code; other values kept as published)  [query Q6.6]
```
level       files     rows   mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  -------  ---  ---------------  --------------  ------------------
agency          4   39,775    1             0.28  DOD-AR                           0
department    141  293,975  7.2              0.3  DOD                              0
gov             1   10,869  0.3             0.32  GOV                              0
```

Option C by series at subelement level (what a subelement filter would add)  [query Q6.7]
```
files       rows     mb  largest_file_mb  largest_entity  files_over_3mb_cap
-----  ---------  -----  ---------------  --------------  ------------------
  653  4,686,275  119.8             1.58  AF1M                             0
```

Option C by series, GOV file only, if limited to the months since Oct 2020 (a layout lever)  [query Q6.8]
```
since_oct2020    rows    mb
-------------  ------  ----
false          73,722  2.06
true           47,564  1.33
```

Option D: the Look-Up files a browser filter over one series would load (file sizes in warehouse/lookup/)  [query Q6.9]
```
dataset      files    mb  largest_mb
-----------  -----  ----  ----------
accessions      16  18.4        1.68
employment     125     8        2.03
separations     16  24.7        2.41
               157  51.1        2.41
```

## 7. Headcount change vs net flow by occupation

**Answer.** There is no person ID, so changes of series cannot be followed. A cheap lower bound: per fiscal year, the
gap between a series' September-to-September headcount change and its net flow; series gaps that offset each other
must be people who moved between series without a hire or departure. The total gap equals the core cube's
reconciliation gap (FY2013 944, FY2022 -29,450, FY2025 93,325, checked against `warehouse/cubes/core/GOV.json`).
Government-wide at least 20,950 to 33,096 people a year changed series in FY2013 to FY2024, 8 to 15% of the year's
hires (Q7.1); the FY2025 bound (12,018) is depressed by the large same-sign gap of that year (September departures
still in the September file). The gaps concentrate in the general series people are promoted or reassigned into:
FY2025 0343 +7,889, 2210 +6,524, 0301 +5,616, 0962 +4,295 (Q7.2). Summed over departments the bound is larger (FY2023
37,584 vs 33,096 government-wide, Q7.4), because moves between departments in the same series also show there.
Consequence: by occupation, headcount change and net flow differ by thousands a year in the largest series, so the
two must stay separate series (invariant 7) and the reconciliation rule cannot be applied per series.

Headcount change minus net flow by series, government-wide, FY2013 to FY2025 (September to September); min_moves = (sum of |series gap| - |total gap|) / 2, a lower bound on people whose series changed without a hire or departure  [query Q7.1]
```
fy      gap_total  sum_abs_gap  min_moves    hires  min_moves_pct_of_hires
------  ---------  -----------  ---------  -------  ----------------------
FY2013        944       55,224     27,140  185,354                    14.6
FY2014     -2,087       48,953     23,433  205,184                    11.4
FY2015      5,908       51,858     22,975  250,972                     9.2
FY2016       -843       57,007     28,082  260,606                    10.8
FY2017    -10,251       52,151     20,950  228,688                     9.2
FY2018     -7,984       59,234     25,625  255,749                      10
FY2019     -6,252       68,700     31,224  280,843                    11.1
FY2020     -3,582       59,796     28,107  274,648                    10.2
FY2021     -2,174       54,510     26,168  262,786                      10
FY2022    -29,450       80,092     25,321  308,800                     8.2
FY2023     -4,235       70,427     33,096  325,639                    10.2
FY2024     -8,128       66,046     28,959  283,157                    10.2
FY2025     93,325      117,361     12,018  152,831                     7.9
```

The 10 series with the largest |headcount change - net flow|, government-wide, FY2023 to FY2025  [query Q7.2]
```
fy      rnk  series  latest_name                                  gap
------  ---  ------  ----------------------------------------  ------
FY2023    1  0343    MANAGEMENT AND PROGRAM ANALYSIS            4,336
FY2023    2  0679    MEDICAL SUPPORT ASSISTANCE                -3,253
FY2023    3  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM   3,141
FY2023    4  0303    MISCELLANEOUS CLERK AND ASSISTANT         -3,043
FY2023    5  0201    HUMAN RESOURCES MANAGEMENT                 2,592
FY2023    6  0501    FINANCIAL ADMINISTRATION AND PROGRAM       1,590
FY2023    7  0340    PROGRAM MANAGEMENT                         1,537
FY2023    8  0610    NURSE                                      1,383
FY2023    9  1811    CRIMINAL INVESTIGATION                     1,337
FY2023   10  0621    NURSING ASSISTANT                         -1,230
FY2024    1  0303    MISCELLANEOUS CLERK AND ASSISTANT         -5,384
FY2024    2  0343    MANAGEMENT AND PROGRAM ANALYSIS            3,839
FY2024    3  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM   2,661
FY2024    4  0962    CONTACT REPRESENTATIVE                    -2,277
FY2024    5  0679    MEDICAL SUPPORT ASSISTANCE                -2,055
FY2024    6  0201    HUMAN RESOURCES MANAGEMENT                 1,637
FY2024    7  1802    COMPLIANCE INSPECTION AND SUPPORT         -1,480
FY2024    8  0340    PROGRAM MANAGEMENT                         1,325
FY2024    9  0501    FINANCIAL ADMINISTRATION AND PROGRAM       1,317
FY2024   10  0456    WILDLAND FIRE MANAGEMENT                   1,288
FY2025    1          NO DATA REPORTED                           9,988
FY2025    2  0343    MANAGEMENT AND PROGRAM ANALYSIS            7,889
FY2025    3  2210    INFORMATION TECHNOLOGY MANAGEMENT          6,524
FY2025    4  0301    MISCELLANEOUS ADMINISTRATION AND PROGRAM   5,616
FY2025    5  0962    CONTACT REPRESENTATIVE                     4,295
FY2025    6  0201    HUMAN RESOURCES MANAGEMENT                 3,447
FY2025    7  0592    TAX EXAMINING                              3,280
FY2025    8  0905    GENERAL ATTORNEY                           2,829
FY2025    9  0501    FINANCIAL ADMINISTRATION AND PROGRAM       2,699
FY2025   10  0512    INTERNAL REVENUE AGENT                     2,578
```

Department level, FY2025: the 10 departments with the largest lower-bound moves  [query Q7.3]
```
entity  gap_total  sum_abs_gap  min_moves   hires
------  ---------  -----------  ---------  ------
DOD        20,819       35,815      7,498  49,344
VA          6,449       10,805      2,178  25,868
HS          3,681        7,515      1,917  22,818
DJ          3,985        6,839      1,427   6,232
SZ            800        2,670        935     371
IN          2,709        4,419        855  10,383
CM            688        2,034        673   4,498
AG         13,021       14,245        612   7,351
HE            224          996        386   4,609
AM            690        1,108        209     405
```

Sum over departments of the lower-bound moves vs the government-wide figure, FY2023 to FY2025 (moves between departments that keep the series show at department level as a gap, not at GOV level)  [query Q7.4]
```
fy      level       min_moves    hires
------  ----------  ---------  -------
FY2023  gov            33,096  325,639
FY2023  department     37,584  325,639
FY2024  gov            28,959  283,157
FY2024  department     33,298  283,157
FY2025  gov            12,018  152,831
FY2025  department     18,036  152,831
```

## 8. Subelement level and full-build totals

**Answer.** Signed scope (occupation spec, D-037): occupations at government, department, DOD agency and subelement
level. Same conventions as section 6 (compact JSON row bytes plus a 200 B header per file; one file per entity and
option; subelements are all 653 codes the core cubes have, including ended ones). The first three levels of Q8.1,
Q8.3 and Q8.4 reproduce the rows of Q6.4, Q6.6 and Q6.5, and the Q8.4 subelement row reproduces Q6.7.

- (a) Option B by series, latest t12 window only: subelements add 653 files, 674,174 rows, 31.35 MB, largest AF1M
  0.40 MB, none over 3 MB; all four levels 799 files, 900,874 rows, 42.31 MB, largest GOV 0.88 MB (Q8.1).
- (b) Option B by family: subelements 653 files, 196,617 rows, 9.13 MB, largest AF1M 0.06 MB; all four levels 799
  files, 11.43 MB, largest GOV 0.09 MB (Q8.2).
- (c) Option C1, monthly by family: subelements 653 files, 1,394,089 rows, 33.51 MB, largest AF1M 0.24 MB; all four
  levels 799 files, 42.05 MB, largest GOV 0.32 MB, none over the cap (Q8.3).
- (d) Option C2, monthly by series: subelements 653 files, 4,686,275 rows, 119.78 MB, largest AF1M 1.58 MB (as Q6.7);
  all four levels 799 files, 162.39 MB, with GOV 3.39 MB the one file over the cap (Q8.4). From Oct 2020 only:
  subelements 582 files, 45.98 MB, largest AF1M 0.59 MB; all four levels 720 files, 62.47 MB, GOV 1.33 MB, none over
  the cap (Q8.5).

Small cells dominate at subelement level: by series, 74.1% of FY2025 departure cells (16,186) and 75.1% at t12
(15,656) have under 10 departures; hires 81.9% (9,727 cells) and 79.2% (6,969). By family, 58.3% and 58.9% of
departure cells and 69.2% and 69.4% of hire cells are under 10 (Q8.6; the series rows equal Q5.4). In Aug 2026, 81
subelements have 1 to 29 employees (1,218 people in all), 187 have 30 to 499, 175 have 500 to 4,999 and 71 have 5,000
or more; 139 of the 653 codes have no employees that month (Q8.7).

Totals for a full occupations build (all four levels; one file per entity and option):

- S1 = B by series + C1 by family at all four levels + C2 by series at GOV only: 799 + 799 + 1 = 1,599 files,
  2,760,868 rows, 42.31 + 42.05 + 3.39 = 87.75 MB; the GOV C2 file (3.39 MB) is the one over the 3 MB cap, and
  limiting it to Oct 2020 onward makes S1 85.69 MB with none over (Q8.1, Q8.3, Q8.4, Q8.5).
- S2 = S1 + C2 at departments, DOD agencies and subelements: 799 + 799 + 799 = 2,397 files, 8,955,628 rows,
  42.31 + 42.05 + 162.39 = 246.75 MB, more than all cubes today (236.5 MB); the subelement C2 files alone are
  119.78 MB. With C2 from Oct 2020 only at every level: 799 + 799 + 720 = 2,318 files, 146.83 MB, none over the cap
  (Q8.1, Q8.3, Q8.5).

Option B by series at all four levels (GOV, departments, DOD agencies, subelements), latest t12 window only (fy FY2012 to FY2026, t12 2026-08, admin, admin_n); row as Q6.3; the first three levels reproduce Q6.4  [query Q8.1]
```
level       files     rows     mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  -------  -----  ---------------  --------------  ------------------
agency          4   42,941   2.13             0.62  DOD-NV                           0
department    141  167,406   7.96             0.74  DOD                              0
gov             1   16,353   0.88             0.88  GOV                              0
subelement    653  674,174  31.35              0.4  AF1M                             0
all           799  900,874  42.31             0.88  GOV                              0
```

Option B by family (first two digits of a 4-digit code; other values kept as published) at all four levels, latest t12 window only  [query Q8.2]
```
level       files     rows     mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  -------  -----  ---------------  --------------  ------------------
agency          4    5,409   0.29             0.08  DOD-AR                           0
department    141   40,741   1.93             0.08  DOD                              0
gov             1    1,462   0.09             0.09  GOV                              0
subelement    653  196,617   9.13             0.06  AF1M                             0
all           799  244,229  11.43             0.09  GOV                              0
```

Option C1: monthly by family [month, family, headcount, hires, departures] per entity file at all four levels, Oct 2011 to Aug 2026; the first three levels reproduce Q6.6  [query Q8.3]
```
level       files       rows     mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  ---------  -----  ---------------  --------------  ------------------
agency          4     39,775   1.05             0.28  DOD-AR                           0
department    141    293,975   7.17              0.3  DOD                              0
gov             1     10,869   0.32             0.32  GOV                              0
subelement    653  1,394,089  33.51             0.24  AF1M                             0
all           799  1,738,708  42.05             0.32  GOV                              0
```

Option C2: monthly by series at all four levels, Oct 2011 to Aug 2026 (reproduces Q6.5 and Q6.7)  [query Q8.4]
```
level       files       rows      mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  ---------  ------  ---------------  --------------  ------------------
agency          4    314,955    8.33             2.44  DOD-NV                           0
department    141  1,193,530    30.9             2.88  DOD                              0
gov             1    121,286    3.39             3.39  GOV                              1
subelement    653  4,686,275  119.78             1.58  AF1M                             0
all           799  6,316,046  162.39             3.39  GOV                              1
```

Option C2 limited to the months since Oct 2020 (Oct 2020 to Aug 2026), all four levels  [query Q8.5]
```
level       files       rows     mb  largest_file_mb  largest_entity  files_over_3mb_cap
----------  -----  ---------  -----  ---------------  --------------  ------------------
agency          4    120,777   3.19             0.93  DOD-NV                           0
department    133    461,788  11.97             1.12  DOD                              0
gov             1     47,564   1.33             1.33  GOV                              0
subelement    582  1,795,565  45.98             0.59  AF1M                             0
all           720  2,425,694  62.47             1.33  GOV                              0
```

Subelement cells with at least one event, by series and by family, FY2025 and t12 to Aug 2026 (Q5.4 convention)  [query Q8.6]
```
key     flow        grain        cells_with_events    lt10  pct_lt10    lt30  pct_lt30
------  ----------  -----------  -----------------  ------  --------  ------  --------
series  departures  fy FY2025               16,186  11,993      74.1  14,311      88.4
series  departures  t12 2026-08             15,656  11,763      75.1  13,964      89.2
series  hires       fy FY2025                9,727   7,966      81.9   9,051      93.1
series  hires       t12 2026-08              6,969   5,519      79.2   6,359      91.2
family  departures  fy FY2025                6,046   3,525      58.3   4,633      76.6
family  departures  t12 2026-08              5,939   3,500      58.9   4,607      77.6
family  hires       fy FY2025                4,350   3,012      69.2   3,741        86
family  hires       t12 2026-08              3,425   2,377      69.4   2,939      85.8
```

Subelement codes by Aug 2026 headcount (employment file rows by agency_subelement_code); band 0 = no employees that month (ended, or actions only), 1 = 1 to 29, 2 = 30 to 499, 3 = 500 to 4,999, 4 = 5,000 and over; blank = all codes  [query Q8.7]
```
band  subelements  employees
----  -----------  ---------
   0          139          0
   1           81      1,218
   2          187     33,989
   3          175    306,294
   4           71  1,683,331
              653  2,024,832
```

## Recommendation

Feasible, with the family as a free second level. The series code is complete, never redacted and spelled one way,
and OPM's family code and name come with every row, so no crosswalk or name grouping is needed; the one data issue to
sign is the blank separations code from Jun 2024 (KDI-002 scope), shown as its own "not reported" row. For the top
lists, option A at fy, latest t12 and administration grain costs about 3 MB (23 MB if every t12 window is kept, as the
breakdown cubes do); for flexibility, option B with only the latest t12 window (11 MB, no file over the cap) gives the
same lists plus rates and lets the page rank by either flow, so B is the better build, with A as the fallback. For the
filter, a family filter (option C by family, 8.5 MB for GOV, departments and DOD agencies) fits easily; a series
filter is 42.6 MB and needs GOV split (for example by year range) to meet the 3 MB cap; subelement level (another
120 MB) and the Look-Up route (43 MB per query, no headcount history) are not worth it. Department-series cells are
mostly under 10 events and two thirds of department-series rates would carry small-base flags, so department views
should default to families or to the top lists, with the series level offered government-wide. Headcount change and
net flow by occupation must stay separate and be labeled as such, since tens of thousands change series each year
without a hire or departure.

## Appendix: query SQL

Views (pipeline/profile/occupations_views.py), run against warehouse/opm.duckdb attached read-only as `w`:
```sql
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
```

Helper `windows`:
```sql
CREATE OR REPLACE TEMP TABLE months AS
  SELECT range::DATE AS month FROM range(DATE '2011-10-01', DATE '2026-09-01', INTERVAL 1 MONTH);
CREATE OR REPLACE TEMP TABLE adm AS SELECT * FROM (VALUES
  ('obama2', DATE '2013-01-01', DATE '2016-12-01'), ('trump1', DATE '2017-01-01', DATE '2020-12-01'),
  ('biden', DATE '2021-01-01', DATE '2024-12-01'), ('trump2', DATE '2025-01-01', DATE '2026-08-01')) t(id, f, l);
CREATE OR REPLACE TEMP TABLE windows AS
  SELECT 'fy' AS grain, 'FY' || (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS period, month FROM months
  UNION ALL
  SELECT 't12', strftime(e.month, '%Y-%m'), m.month FROM months e JOIN months m
    ON m.month > e.month - INTERVAL 12 MONTH AND m.month <= e.month WHERE e.month >= DATE '2012-09-01'
  UNION ALL
  SELECT 'admin', id, month FROM adm JOIN months ON month BETWEEN f AND l
  UNION ALL
  SELECT 'admin_n', a.id, month FROM adm a JOIN months ON month BETWEEN a.f AND a.f + INTERVAL 19 MONTH;
CREATE OR REPLACE TEMP TABLE window_end AS
  SELECT grain, period, max(month) AS period_end, count(*) AS n_months FROM windows GROUP BY ALL;
```

Helper `flows`:
```sql
CREATE OR REPLACE TEMP TABLE flows AS
WITH a AS (
  SELECT 'hires' AS flow, effective_month AS month, department_code, agency_code, agency_subelement_code,
         occupational_series_code AS series, (action_code IN ('AA', 'AB')) AS transfer FROM acc
  UNION ALL
  SELECT 'departures', effective_month, department_code, agency_code, agency_subelement_code,
         occupational_series_code, (action_code IN ('SA', 'SB')) FROM sep)
SELECT flow, month, level, entity, series, count(*) AS n, count(*) FILTER (WHERE transfer) AS n_transfer FROM (
  SELECT *, 'gov' AS level, 'GOV' AS entity FROM a
  UNION ALL SELECT *, 'department', department_code FROM a
  UNION ALL SELECT *, 'agency', 'DOD-' || agency_code FROM a WHERE department_code = 'DOD'
  UNION ALL SELECT *, 'subelement', agency_subelement_code FROM a)
GROUP BY ALL;
```

Helper `stock`:
```sql
CREATE OR REPLACE TEMP TABLE stock AS
SELECT period AS month, level, entity, occupational_series_code AS series, sum(headcount) AS headcount FROM (
  SELECT *, 'gov' AS level, 'GOV' AS entity FROM emp
  UNION ALL SELECT *, 'department', department_code FROM emp
  UNION ALL SELECT *, 'agency', 'DOD-' || agency_code FROM emp WHERE department_code = 'DOD')
GROUP BY ALL;
```

Helper `names`:
```sql
CREATE OR REPLACE TEMP TABLE series_name AS
SELECT occupational_series_code AS series, arg_max(occupational_series, period) AS latest_name FROM (
  SELECT period, occupational_series_code, occupational_series FROM emp_names
  UNION ALL SELECT period, occupational_series_code, occupational_series FROM acc
  UNION ALL SELECT period, occupational_series_code, occupational_series FROM sep)
GROUP BY 1;
```

Helper `stock_all`:
```sql
CREATE OR REPLACE TEMP TABLE stock_all AS
SELECT month, level, entity, series, headcount FROM stock
UNION ALL
SELECT period, 'subelement', agency_subelement_code, occupational_series_code, sum(headcount) FROM emp GROUP BY ALL;
```

Q1.1
```sql
SELECT CASE WHEN file_name LIKE '%/Accessions/%' THEN 'accessions' WHEN file_name LIKE '%/Separations/%'
            THEN 'separations' ELSE 'employment' END AS dataset,
       name AS column_name, count(DISTINCT file_name) AS files,
       min(regexp_extract(file_name, '_(\d{6})_', 1)) AS first_file, max(regexp_extract(file_name, '_(\d{6})_', 1)) AS last_file,
       string_agg(DISTINCT type, ',') AS parquet_type
FROM parquet_schema('data/*/*.parquet')
WHERE name LIKE 'occupational%' OR name LIKE 'stem%' OR name LIKE 'pay_plan%'
GROUP BY ALL ORDER BY column_name, dataset
```

Q1.2
```sql
SELECT CASE WHEN file_name LIKE '%/Accessions/%' THEN 'accessions' WHEN file_name LIKE '%/Separations/%'
            THEN 'separations' ELSE 'employment' END AS dataset, count(DISTINCT file_name) AS files
FROM parquet_schema('data/*/*.parquet') GROUP BY 1 ORDER BY 1
```

Q1.3
```sql
SELECT dataset, sum(n) AS rows_,
  sum(n) FILTER (WHERE occupational_series_code IS NULL) AS series_code_null,
  sum(n) FILTER (WHERE occupational_series IS NULL) AS series_name_null,
  sum(n) FILTER (WHERE occupational_group_code IS NULL) AS group_code_null,
  sum(n) FILTER (WHERE occupational_category_code IS NULL) AS category_code_null,
  sum(n) FILTER (WHERE occupational_category IS NULL) AS category_name_null,
  sum(n) FILTER (WHERE pay_plan_code IS NULL) AS pay_plan_code_null
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) GROUP BY 1 ORDER BY 1
```

Q1.4
```sql
SELECT occupational_category_code, occupational_category,
  sum(n) FILTER (WHERE dataset = 'accessions') AS accessions,
  sum(n) FILTER (WHERE dataset = 'separations') AS separations,
  sum(n) FILTER (WHERE dataset = 'employment') AS employment_person_months
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) GROUP BY ALL ORDER BY 1, 2
```

Q2.1
```sql
SELECT dataset,
  count(DISTINCT occupational_series_code) AS codes_all_time,
  count(DISTINCT occupational_series_code) FILTER (WHERE regexp_full_match(occupational_series_code, '\d{4}')) AS four_digit_all_time,
  count(DISTINCT occupational_series_code) FILTER (WHERE month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01') AS codes_t12,
  count(DISTINCT occupational_series_code) FILTER (WHERE month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' AND regexp_full_match(occupational_series_code, '\d{4}')) AS four_digit_t12,
  count(DISTINCT occupational_series_code) FILTER (WHERE month = DATE '2026-08-01' AND regexp_full_match(occupational_series_code, '\d{4}')) AS four_digit_aug2026
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) GROUP BY 1
UNION ALL
SELECT 'any of the three', count(DISTINCT occupational_series_code),
  count(DISTINCT occupational_series_code) FILTER (WHERE regexp_full_match(occupational_series_code, '\d{4}')),
  count(DISTINCT occupational_series_code) FILTER (WHERE month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01'),
  count(DISTINCT occupational_series_code) FILTER (WHERE month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' AND regexp_full_match(occupational_series_code, '\d{4}')), NULL
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) ORDER BY 1
```

Q2.2
```sql
WITH n AS (SELECT occupational_series_code AS code, occupational_series AS name, min(period) AS first_file,
                  max(period) AS last_file, sum(n) AS rows_ FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE regexp_full_match(occupational_series_code, '\d{4}') GROUP BY ALL)
SELECT (SELECT count(DISTINCT code) FROM n) AS codes,
       (SELECT count(*) FROM (SELECT code FROM n GROUP BY 1 HAVING count(*) > 1)) AS codes_with_2plus_names,
       (SELECT max(c) FROM (SELECT count(*) c FROM n GROUP BY code)) AS max_names_per_code,
       (SELECT count(*) FROM (SELECT name FROM n GROUP BY 1 HAVING count(DISTINCT code) > 1)) AS names_on_2plus_codes
```

Q2.3
```sql
WITH n AS (SELECT occupational_series_code AS code, occupational_series AS name, min(period) AS first_file,
                  max(period) AS last_file, sum(n) AS rows_ FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE regexp_full_match(occupational_series_code, '\d{4}') GROUP BY ALL)
SELECT code, name, strftime(first_file, '%Y-%m') AS first_file, strftime(last_file, '%Y-%m') AS last_file, rows_
FROM n WHERE code IN (SELECT code FROM n GROUP BY 1 HAVING count(*) > 1) ORDER BY code, first_file
```

Q2.4
```sql
SELECT dataset, CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END AS class, '[' || coalesce(occupational_series_code, 'NULL') || ']' AS code_as_published,
       occupational_series AS name, sum(n) AS rows_
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END <> 'ok' GROUP BY ALL ORDER BY dataset, rows_ DESC
```

Q2.5
```sql
SELECT dataset, 'FY' || (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, sum(n) AS rows_,
  sum(n) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END = 'blank') AS blank,
  sum(n) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END = 'star_invalid') AS star_invalid,
  sum(n) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END = 'redacted') AS redacted,
  sum(n) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END = 'other_non_4_digit') AS other,
  round(100.0 * sum(n) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END NOT IN ('ok', 'valid_code_bad_name')) / sum(n), 3) AS pct_unusable
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) GROUP BY ALL ORDER BY dataset, fy
```

Q2.6
```sql
WITH d AS (
  SELECT dataset, 'all' AS span, department_code, count(*) AS rows_,
         count(*) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END NOT IN ('ok', 'valid_code_bad_name')) AS unusable
  FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE dataset <> 'employment' GROUP BY ALL HAVING count(*) >= 1000
  UNION ALL
  SELECT dataset, 't12', department_code, count(*),
         count(*) FILTER (WHERE CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END NOT IN ('ok', 'valid_code_bad_name'))
  FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE dataset <> 'employment' AND month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' GROUP BY ALL HAVING count(*) >= 100),
r AS (SELECT *, round(100.0 * unusable / rows_, 2) AS pct,
             row_number() OVER (PARTITION BY dataset, span ORDER BY unusable / rows_ DESC, department_code) AS rnk FROM d)
SELECT dataset, span, rnk, department_code, rows_, unusable, pct FROM r WHERE rnk <= 10 ORDER BY dataset, span, rnk
```

Q2.7
```sql
WITH d AS (SELECT department_code, sum(headcount) AS headcount,
                  sum(headcount) FILTER (WHERE NOT regexp_full_match(occupational_series_code, '\d{4}')) AS unusable
           FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1 HAVING sum(headcount) >= 100)
SELECT department_code, headcount, coalesce(unusable, 0) AS unusable,
       round(100.0 * coalesce(unusable, 0) / headcount, 2) AS pct
FROM d ORDER BY pct DESC, department_code LIMIT 10
```

Q2.8
```sql
SELECT CASE WHEN period >= DATE '2024-06-01' THEN 'Jun 2024 to Aug 2026 files' ELSE 'Oct 2011 to May 2024 files' END AS files,
  count(*) AS separations,
  count(*) FILTER (WHERE occupational_category IS NULL OR occupational_category = 'NO DATA REPORTED') AS category_bad,
  count(*) FILTER (WHERE (occupational_category IS NULL OR occupational_category = 'NO DATA REPORTED') AND regexp_full_match(occupational_series_code, '\d{4}'))
    AS category_bad_series_4_digit,
  count(*) FILTER (WHERE NOT regexp_full_match(occupational_series_code, '\d{4}')) AS series_not_4_digit,
  round(100.0 * count(*) FILTER (WHERE NOT regexp_full_match(occupational_series_code, '\d{4}')) / count(*), 2) AS pct_series_not_4_digit,
  count(*) FILTER (WHERE occupational_group_code IS NULL OR occupational_group_code IN ('NO DATA REPORTED', '*', 'INVALID'))
    AS group_bad
FROM sep GROUP BY 1 ORDER BY 1 DESC
```

Q2.9
```sql
SELECT strftime(period, '%Y-%m') AS file_month, count(*) AS separations,
       count(*) FILTER (WHERE trim(occupational_series_code) = '') AS blank_series,
       round(100.0 * count(*) FILTER (WHERE trim(occupational_series_code) = '') / count(*), 2) AS pct
FROM sep WHERE period >= DATE '2024-06-01' GROUP BY 1 ORDER BY 1
```

Q3.1
```sql
SELECT dataset, count(*) AS code_group_pairs,
  count(*) FILTER (WHERE grp = left(code, 2)) AS equal_first_two,
  count(*) FILTER (WHERE grp IS NULL) AS group_null,
  count(*) FILTER (WHERE grp IS NOT NULL AND grp <> left(code, 2)) AS differ
FROM (SELECT DISTINCT dataset, occupational_series_code AS code, occupational_group_code AS grp FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names)
      WHERE regexp_full_match(occupational_series_code, '\d{4}')) GROUP BY 1 ORDER BY 1
```

Q3.2
```sql
SELECT dataset, occupational_series_code AS code, occupational_series AS name, sum(n) AS rows_,
       strftime(min(period), '%Y-%m') AS first_file, strftime(max(period), '%Y-%m') AS last_file
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE regexp_full_match(occupational_series_code, '\d{4}') AND occupational_group_code IS NULL GROUP BY ALL ORDER BY dataset, code
```

Q3.3
```sql
SELECT occupational_group_code AS grp, count(DISTINCT occupational_group) AS names_all_files,
  arg_max(occupational_group, period) AS latest_name,
  count(DISTINCT occupational_series_code) FILTER (WHERE period = DATE '2026-08-01') AS codes_aug2026,
  sum(n) FILTER (WHERE period = DATE '2026-08-01' AND dataset = 'employment') AS headcount_aug2026
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE regexp_full_match(occupational_series_code, '\d{4}') GROUP BY 1 ORDER BY 1
```

Q3.4
```sql
SELECT occupational_group_code AS grp, occupational_group AS name, sum(n) AS rows_
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE occupational_group_code IN (SELECT occupational_group_code FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names)
  GROUP BY 1 HAVING count(DISTINCT occupational_group) > 1) GROUP BY ALL ORDER BY 1, 2
```

Q3.5
```sql
SELECT dataset, occupational_series_code >= '2500' AS code_2500_plus, occupational_category_code, sum(n) AS rows_
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE regexp_full_match(occupational_series_code, '\d{4}') GROUP BY ALL ORDER BY 1, 2, 3
```

Q3.6
```sql
SELECT dataset, occupational_series_code >= '2500' AS code_2500_plus, left(pay_plan_code, 1) = 'W' AS pay_plan_w,
       sum(n) AS rows_
FROM (SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names) WHERE regexp_full_match(occupational_series_code, '\d{4}') AND (dataset <> 'employment' OR period = DATE '2026-08-01') GROUP BY ALL ORDER BY 1, 2, 3
```

Q3.7
```sql
SELECT pay_plan_code, sum(rows) AS headcount FROM emp_names
WHERE period = DATE '2026-08-01' AND regexp_full_match(occupational_series_code, '\d{4}') AND occupational_series_code >= '2500' AND left(pay_plan_code, 1) <> 'W'
GROUP BY 1 ORDER BY 2 DESC LIMIT 15
```

Q4.1a (helpers: flows, names)
```sql
WITH f AS (SELECT entity, series, sum(n) AS n, sum(n_transfer) AS n_transfer FROM flows
           WHERE flow = 'hires' AND month BETWEEN DATE '2024-10-01' AND DATE '2025-09-01' AND (entity = 'GOV' OR entity IN (SELECT department_code FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1
                    ORDER BY sum(headcount) DESC LIMIT 5)) AND level IN ('gov', 'department') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY entity ORDER BY n DESC, series) AS rnk,
             sum(n) OVER (PARTITION BY entity) AS total FROM f)
SELECT entity, rnk, series, latest_name, n AS hires, round(100.0 * n / total, 2) AS pct_of_total,
       round(100.0 * n_transfer / n, 1) AS pct_transfer
FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 15 ORDER BY entity, rnk
```

Q4.1b (helpers: flows, names)
```sql
WITH f AS (SELECT entity, series, sum(n) AS n, sum(n_transfer) AS n_transfer FROM flows
           WHERE flow = 'hires' AND month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' AND (entity = 'GOV' OR entity IN (SELECT department_code FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1
                    ORDER BY sum(headcount) DESC LIMIT 5)) AND level IN ('gov', 'department') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY entity ORDER BY n DESC, series) AS rnk,
             sum(n) OVER (PARTITION BY entity) AS total FROM f)
SELECT entity, rnk, series, latest_name, n AS hires, round(100.0 * n / total, 2) AS pct_of_total,
       round(100.0 * n_transfer / n, 1) AS pct_transfer
FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 15 ORDER BY entity, rnk
```

Q4.2a (helpers: flows, names)
```sql
WITH f AS (SELECT entity, series, sum(n) AS n, sum(n_transfer) AS n_transfer FROM flows
           WHERE flow = 'departures' AND month BETWEEN DATE '2024-10-01' AND DATE '2025-09-01' AND (entity = 'GOV' OR entity IN (SELECT department_code FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1
                    ORDER BY sum(headcount) DESC LIMIT 5)) AND level IN ('gov', 'department') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY entity ORDER BY n DESC, series) AS rnk,
             sum(n) OVER (PARTITION BY entity) AS total FROM f)
SELECT entity, rnk, series, latest_name, n AS departures, round(100.0 * n / total, 2) AS pct_of_total,
       round(100.0 * n_transfer / n, 1) AS pct_transfer
FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 15 ORDER BY entity, rnk
```

Q4.2b (helpers: flows, names)
```sql
WITH f AS (SELECT entity, series, sum(n) AS n, sum(n_transfer) AS n_transfer FROM flows
           WHERE flow = 'departures' AND month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' AND (entity = 'GOV' OR entity IN (SELECT department_code FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1
                    ORDER BY sum(headcount) DESC LIMIT 5)) AND level IN ('gov', 'department') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY entity ORDER BY n DESC, series) AS rnk,
             sum(n) OVER (PARTITION BY entity) AS total FROM f)
SELECT entity, rnk, series, latest_name, n AS departures, round(100.0 * n / total, 2) AS pct_of_total,
       round(100.0 * n_transfer / n, 1) AS pct_transfer
FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 15 ORDER BY entity, rnk
```

Q4.3 (helpers: flows)
```sql
WITH f AS (SELECT CASE WHEN month BETWEEN DATE '2024-10-01' AND DATE '2025-09-01' THEN 'FY2025' END AS w1, CASE WHEN month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' THEN 't12' END AS w2,
                  flow, entity, series, n FROM flows
           WHERE level IN ('gov', 'department') AND (entity = 'GOV' OR entity IN (SELECT department_code FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1
                    ORDER BY sum(headcount) DESC LIMIT 5))),
g AS (SELECT w1 AS win, flow, entity, series, sum(n) AS n FROM f WHERE w1 IS NOT NULL GROUP BY ALL
      UNION ALL SELECT w2, flow, entity, series, sum(n) FROM f WHERE w2 IS NOT NULL GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY win, flow, entity ORDER BY n DESC, series) AS rnk FROM g)
SELECT win, flow, entity, sum(n) AS total, count(*) AS series_with_events,
  round(100.0 * sum(n) FILTER (WHERE rnk <= 10) / sum(n), 1) AS pct_top10,
  round(100.0 * sum(n) FILTER (WHERE rnk <= 25) / sum(n), 1) AS pct_top25
FROM r GROUP BY ALL ORDER BY win, flow, total DESC
```

Q4.4 (helpers: flows)
```sql
WITH f AS (SELECT CASE WHEN month BETWEEN DATE '2024-10-01' AND DATE '2025-09-01' THEN 'FY2025' END AS w1, CASE WHEN month BETWEEN DATE '2025-09-01' AND DATE '2026-08-01' THEN 't12' END AS w2,
                  flow, series, n, n_transfer FROM flows WHERE level = 'gov'),
g AS (SELECT w1 AS win, flow, series, sum(n) AS n, sum(n_transfer) AS t FROM f WHERE w1 IS NOT NULL GROUP BY ALL
      UNION ALL SELECT w2, flow, series, sum(n), sum(n_transfer) FROM f WHERE w2 IS NOT NULL GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY win, flow ORDER BY n DESC, series) AS rnk FROM g)
SELECT win, flow, sum(n) FILTER (WHERE rnk <= 10) AS top10_events, sum(t) FILTER (WHERE rnk <= 10) AS top10_transfers,
  round(100.0 * sum(t) FILTER (WHERE rnk <= 10) / sum(n) FILTER (WHERE rnk <= 10), 1) AS pct_transfer_top10,
  round(100.0 * sum(t) / sum(n), 1) AS pct_transfer_all_series,
  round(100.0 * sum(t) FILTER (WHERE rnk <= 10) / sum(t), 1) AS top10_pct_of_all_transfers
FROM r GROUP BY ALL ORDER BY 1, 2
```

Q5.1 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain, w.period, f.flow, f.level, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department') GROUP BY ALL)
SELECT level, flow, grain AS grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, count(*) FILTER (WHERE n < 30) AS lt30,
  round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM c  GROUP BY ALL ORDER BY level, flow, grain
```

Q5.2 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain, w.period, f.flow, f.level, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department') GROUP BY ALL)
SELECT level, flow, grain || ' ' || period AS grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, count(*) FILTER (WHERE n < 30) AS lt30,
  round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM c WHERE (grain, period) IN (('fy', 'FY2025'), ('t12', '2026-08'), ('admin', 'trump2')) GROUP BY ALL ORDER BY level, flow, grain
```

Q5.3 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain, w.period, f.flow, f.level, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('agency', 'subelement') GROUP BY ALL)
SELECT level, flow, grain AS grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, count(*) FILTER (WHERE n < 30) AS lt30,
  round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM c  GROUP BY ALL ORDER BY level, flow, grain
```

Q5.4 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain, w.period, f.flow, f.level, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('agency', 'subelement') GROUP BY ALL)
SELECT level, flow, grain || ' ' || period AS grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, count(*) FILTER (WHERE n < 30) AS lt30,
  round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM c WHERE (grain, period) IN (('fy', 'FY2025'), ('t12', '2026-08'), ('admin', 'trump2')) GROUP BY ALL ORDER BY level, flow, grain
```

Q5.5 (helpers: windows, flows, stock)
```sql
WITH st AS (SELECT w.grain, w.period, s.level, s.entity, s.series, sum(s.headcount) / any_value(e.n_months) AS avg_hc
            FROM stock s JOIN windows w USING (month) JOIN window_end e USING (grain, period)
            WHERE (w.grain, w.period) IN (('fy', 'FY2025'), ('t12', '2026-08')) AND s.level IN ('gov', 'department')
            GROUP BY ALL),
fl AS (SELECT w.grain, w.period, f.level, f.entity, f.series, sum(f.n) AS n FROM flows f JOIN windows w USING (month)
       WHERE (w.grain, w.period) IN (('fy', 'FY2025'), ('t12', '2026-08')) AND f.level IN ('gov', 'department')
       GROUP BY ALL)
SELECT grain || ' ' || period AS window, level, count(*) AS cells,
  count(*) FILTER (WHERE coalesce(avg_hc, 0) = 0) AS avg_headcount_0,
  count(*) FILTER (WHERE avg_hc > 0 AND avg_hc < 30) AS small_base,
  round(100.0 * count(*) FILTER (WHERE coalesce(avg_hc, 0) < 30) / count(*), 1) AS pct_empty_or_small
FROM st FULL JOIN fl USING (grain, period, level, entity, series) GROUP BY ALL ORDER BY 1, 2 DESC
```

Q6.1 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain, w.period, f.flow, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY grain, period, flow, entity ORDER BY n DESC, series) AS rnk FROM c),
k AS (SELECT grain, period, flow, entity, CASE WHEN rnk <= 25 THEN series ELSE 'other' END AS series, sum(n) AS n
      FROM r  GROUP BY ALL)
SELECT count(DISTINCT entity) AS files, count(*) AS rows_,
  round(sum(length('["' || grain || '","' || period || '","' || flow || '","' || series || '",' || n || '],'))
        / 1e6 + count(DISTINCT entity) * 130 / 1e6, 2) AS mb,
  round(max(b) / 1e6, 3) AS largest_file_mb, arg_max(entity, b) AS largest_entity
FROM k JOIN (SELECT entity, sum(length('["' || grain || '","' || period || '","' || flow || '","' || series || '",' || n
             || '],')) AS b FROM k GROUP BY 1) USING (entity)
```

Q6.2 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain, w.period, f.flow, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY grain, period, flow, entity ORDER BY n DESC, series) AS rnk FROM c),
k AS (SELECT grain, period, flow, entity, CASE WHEN rnk <= 25 THEN series ELSE 'other' END AS series, sum(n) AS n
      FROM r WHERE grain <> 't12' OR period = '2026-08' GROUP BY ALL)
SELECT count(DISTINCT entity) AS files, count(*) AS rows_,
  round(sum(length('["' || grain || '","' || period || '","' || flow || '","' || series || '",' || n || '],'))
        / 1e6 + count(DISTINCT entity) * 130 / 1e6, 2) AS mb,
  round(max(b) / 1e6, 3) AS largest_file_mb, arg_max(entity, b) AS largest_entity
FROM k JOIN (SELECT entity, sum(length('["' || grain || '","' || period || '","' || flow || '","' || series || '",' || n
             || '],')) AS b FROM k GROUP BY 1) USING (entity)
```

Q6.3 (helpers: windows, flows, stock)
```sql
WITH fl AS (SELECT w.grain, w.period, f.entity, f.series,
                   sum(f.n) FILTER (WHERE flow = 'hires') AS hires, sum(f.n) FILTER (WHERE flow = 'departures') AS departures,
                   sum(f.n_transfer) FILTER (WHERE flow = 'hires') AS acc_transfer_in,
                   sum(f.n_transfer) FILTER (WHERE flow = 'departures') AS sep_transfer_out
            FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency')  GROUP BY ALL),
st AS (SELECT w.grain, w.period, s.entity, s.series, sum(s.headcount) AS hc_sum,
              sum(s.headcount) FILTER (WHERE s.month = e.period_end) AS headcount, any_value(e.n_months) AS n_months
       FROM stock s JOIN windows w USING (month) JOIN window_end e USING (grain, period) WHERE TRUE  GROUP BY ALL),
k AS (SELECT grain, period, entity, series, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(acc_transfer_in, 0) AS ti, coalesce(sep_transfer_out, 0) AS tout, coalesce(headcount, 0) AS hc,
             round(coalesce(hc_sum, 0) / coalesce(n_months, 12), 4) AS den
      FROM fl FULL JOIN st USING (grain, period, entity, series)),
b AS (SELECT entity, count(*) AS rows_, sum(length('["' || grain || '","' || period || '","' || series || '",' || hires
             || ',' || departures || ',' || ti || ',' || tout || ',' || hc || ',' || den::VARCHAR || ',' ||
             CASE WHEN den < 30 THEN 'true' ELSE 'false' END || '],')) + 200 AS bytes FROM k GROUP BY 1)
SELECT count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb, round(max(bytes) / 1e6, 2) AS largest_file_mb,
       arg_max(entity, bytes) AS largest_entity, count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b
```

Q6.4 (helpers: windows, flows, stock)
```sql
WITH fl AS (SELECT w.grain, w.period, f.entity, f.series,
                   sum(f.n) FILTER (WHERE flow = 'hires') AS hires, sum(f.n) FILTER (WHERE flow = 'departures') AS departures,
                   sum(f.n_transfer) FILTER (WHERE flow = 'hires') AS acc_transfer_in,
                   sum(f.n_transfer) FILTER (WHERE flow = 'departures') AS sep_transfer_out
            FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency') AND (w.grain <> 't12' OR w.period = '2026-08') GROUP BY ALL),
st AS (SELECT w.grain, w.period, s.entity, s.series, sum(s.headcount) AS hc_sum,
              sum(s.headcount) FILTER (WHERE s.month = e.period_end) AS headcount, any_value(e.n_months) AS n_months
       FROM stock s JOIN windows w USING (month) JOIN window_end e USING (grain, period) WHERE TRUE AND (w.grain <> 't12' OR w.period = '2026-08') GROUP BY ALL),
k AS (SELECT grain, period, entity, series, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(acc_transfer_in, 0) AS ti, coalesce(sep_transfer_out, 0) AS tout, coalesce(headcount, 0) AS hc,
             round(coalesce(hc_sum, 0) / coalesce(n_months, 12), 4) AS den
      FROM fl FULL JOIN st USING (grain, period, entity, series)),
b AS (SELECT entity, count(*) AS rows_, sum(length('["' || grain || '","' || period || '","' || series || '",' || hires
             || ',' || departures || ',' || ti || ',' || tout || ',' || hc || ',' || den::VARCHAR || ',' ||
             CASE WHEN den < 30 THEN 'true' ELSE 'false' END || '],')) + 200 AS bytes FROM k GROUP BY 1)
SELECT count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb, round(max(bytes) / 1e6, 2) AS largest_file_mb,
       arg_max(entity, bytes) AS largest_entity, count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b
```

Q6.5 (helpers: flows, stock)
```sql
WITH fl AS (SELECT month, level, entity, series AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ('gov', 'department', 'agency') GROUP BY ALL),
st AS (SELECT month, level, entity, series AS series, sum(headcount) AS headcount FROM stock
       WHERE level IN ('gov', 'department', 'agency') GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY 1 ORDER BY 1
```

Q6.6 (helpers: flows, stock)
```sql
WITH fl AS (SELECT month, level, entity, CASE WHEN regexp_full_match(series, '\d{4}') THEN left(series, 2) ELSE series END AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ('gov', 'department', 'agency') GROUP BY ALL),
st AS (SELECT month, level, entity, CASE WHEN regexp_full_match(series, '\d{4}') THEN left(series, 2) ELSE series END AS series, sum(headcount) AS headcount FROM stock
       WHERE level IN ('gov', 'department', 'agency') GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY 1 ORDER BY 1
```

Q6.7 (helpers: flows)
```sql
WITH fl AS (SELECT month, entity, series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows WHERE level = 'subelement' GROUP BY ALL),
st AS (SELECT period AS month, agency_subelement_code AS entity, occupational_series_code AS series,
              sum(headcount) AS headcount FROM emp GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, entity, series)),
b AS (SELECT entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap FROM b
```

Q6.8 (helpers: flows, stock)
```sql
WITH fl AS (SELECT month, series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows WHERE level = 'gov' GROUP BY ALL),
st AS (SELECT month, series, headcount FROM stock WHERE level = 'gov'),
k AS (SELECT * FROM fl FULL JOIN st USING (month, series))
SELECT month >= DATE '2020-10-01' AS since_oct2020, count(*) AS rows_,
  round(sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' || coalesce(headcount, 0) || ',' ||
        coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) / 1e6, 2) AS mb
FROM k GROUP BY 1 ORDER BY 1
```

Q6.9
```sql
SELECT CASE WHEN filename LIKE '%/separations%' THEN 'separations' WHEN filename LIKE '%/accessions%' THEN 'accessions'
            ELSE 'employment' END AS dataset, count(*) AS files, round(sum(size) / 1e6, 1) AS mb,
       round(max(size) / 1e6, 2) AS largest_mb
FROM read_blob('warehouse/lookup/*.parquet') GROUP BY ROLLUP (1) ORDER BY 1 NULLS LAST
```

Q7.1 (helpers: flows, stock)
```sql
WITH h AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, headcount FROM stock WHERE month(month) = 9 AND level IN ('gov')),
d AS (SELECT a.level, a.entity, a.series, a.fy, a.headcount - coalesce(p.headcount, 0) AS dh FROM h a
      LEFT JOIN h p ON p.level = a.level AND p.entity = a.entity AND p.series = a.series AND p.fy = a.fy - 1
      UNION ALL  -- series that vanished: present last September, absent this September
      SELECT p.level, p.entity, p.series, p.fy + 1, -p.headcount FROM h p
      WHERE NOT EXISTS (SELECT 1 FROM h a WHERE a.level = p.level AND a.entity = p.entity AND a.series = p.series AND a.fy = p.fy + 1)
        AND p.fy < 2025),
n AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, coalesce(sum(n) FILTER (WHERE flow = 'hires'), 0) - coalesce(sum(n) FILTER (WHERE flow = 'departures'), 0)
             AS net_raw, sum(n) FILTER (WHERE flow = 'hires') AS hires FROM flows WHERE level IN ('gov') GROUP BY ALL),
g AS (SELECT level, entity, fy, series, coalesce(dh, 0) - coalesce(net_raw, 0) AS gap, coalesce(hires, 0) AS hires
      FROM d FULL JOIN n USING (level, entity, series, fy) WHERE fy BETWEEN 2013 AND 2025),
e AS (SELECT level, entity, fy, sum(gap) AS gap_total, sum(abs(gap)) AS sum_abs_gap, sum(hires) AS hires FROM g GROUP BY ALL)

SELECT 'FY' || fy AS fy, gap_total, sum_abs_gap, (sum_abs_gap - abs(gap_total)) // 2 AS min_moves, hires,
  round(100.0 * ((sum_abs_gap - abs(gap_total)) / 2) / hires, 1) AS min_moves_pct_of_hires
FROM e ORDER BY fy
```

Q7.2 (helpers: flows, stock, names)
```sql
WITH h AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, headcount FROM stock WHERE month(month) = 9 AND level IN ('gov')),
d AS (SELECT a.level, a.entity, a.series, a.fy, a.headcount - coalesce(p.headcount, 0) AS dh FROM h a
      LEFT JOIN h p ON p.level = a.level AND p.entity = a.entity AND p.series = a.series AND p.fy = a.fy - 1
      UNION ALL  -- series that vanished: present last September, absent this September
      SELECT p.level, p.entity, p.series, p.fy + 1, -p.headcount FROM h p
      WHERE NOT EXISTS (SELECT 1 FROM h a WHERE a.level = p.level AND a.entity = p.entity AND a.series = p.series AND a.fy = p.fy + 1)
        AND p.fy < 2025),
n AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, coalesce(sum(n) FILTER (WHERE flow = 'hires'), 0) - coalesce(sum(n) FILTER (WHERE flow = 'departures'), 0)
             AS net_raw, sum(n) FILTER (WHERE flow = 'hires') AS hires FROM flows WHERE level IN ('gov') GROUP BY ALL),
g AS (SELECT level, entity, fy, series, coalesce(dh, 0) - coalesce(net_raw, 0) AS gap, coalesce(hires, 0) AS hires
      FROM d FULL JOIN n USING (level, entity, series, fy) WHERE fy BETWEEN 2013 AND 2025),
e AS (SELECT level, entity, fy, sum(gap) AS gap_total, sum(abs(gap)) AS sum_abs_gap, sum(hires) AS hires FROM g GROUP BY ALL)

, r AS (SELECT *, row_number() OVER (PARTITION BY fy ORDER BY abs(gap) DESC, series) AS rnk FROM g WHERE fy >= 2023)
SELECT 'FY' || fy AS fy, rnk, series, latest_name, gap FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 10
ORDER BY fy, rnk
```

Q7.3 (helpers: flows, stock)
```sql
WITH h AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, headcount FROM stock WHERE month(month) = 9 AND level IN ('department')),
d AS (SELECT a.level, a.entity, a.series, a.fy, a.headcount - coalesce(p.headcount, 0) AS dh FROM h a
      LEFT JOIN h p ON p.level = a.level AND p.entity = a.entity AND p.series = a.series AND p.fy = a.fy - 1
      UNION ALL  -- series that vanished: present last September, absent this September
      SELECT p.level, p.entity, p.series, p.fy + 1, -p.headcount FROM h p
      WHERE NOT EXISTS (SELECT 1 FROM h a WHERE a.level = p.level AND a.entity = p.entity AND a.series = p.series AND a.fy = p.fy + 1)
        AND p.fy < 2025),
n AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, coalesce(sum(n) FILTER (WHERE flow = 'hires'), 0) - coalesce(sum(n) FILTER (WHERE flow = 'departures'), 0)
             AS net_raw, sum(n) FILTER (WHERE flow = 'hires') AS hires FROM flows WHERE level IN ('department') GROUP BY ALL),
g AS (SELECT level, entity, fy, series, coalesce(dh, 0) - coalesce(net_raw, 0) AS gap, coalesce(hires, 0) AS hires
      FROM d FULL JOIN n USING (level, entity, series, fy) WHERE fy BETWEEN 2013 AND 2025),
e AS (SELECT level, entity, fy, sum(gap) AS gap_total, sum(abs(gap)) AS sum_abs_gap, sum(hires) AS hires FROM g GROUP BY ALL)

SELECT entity, gap_total, sum_abs_gap, (sum_abs_gap - abs(gap_total)) // 2 AS min_moves, hires
FROM e WHERE fy = 2025 ORDER BY min_moves DESC LIMIT 10
```

Q7.4 (helpers: flows, stock)
```sql
WITH h AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, headcount FROM stock WHERE month(month) = 9 AND level IN ('gov', 'department')),
d AS (SELECT a.level, a.entity, a.series, a.fy, a.headcount - coalesce(p.headcount, 0) AS dh FROM h a
      LEFT JOIN h p ON p.level = a.level AND p.entity = a.entity AND p.series = a.series AND p.fy = a.fy - 1
      UNION ALL  -- series that vanished: present last September, absent this September
      SELECT p.level, p.entity, p.series, p.fy + 1, -p.headcount FROM h p
      WHERE NOT EXISTS (SELECT 1 FROM h a WHERE a.level = p.level AND a.entity = p.entity AND a.series = p.series AND a.fy = p.fy + 1)
        AND p.fy < 2025),
n AS (SELECT level, entity, series, (year(month) + CASE WHEN month(month) >= 10 THEN 1 ELSE 0 END) AS fy, coalesce(sum(n) FILTER (WHERE flow = 'hires'), 0) - coalesce(sum(n) FILTER (WHERE flow = 'departures'), 0)
             AS net_raw, sum(n) FILTER (WHERE flow = 'hires') AS hires FROM flows WHERE level IN ('gov', 'department') GROUP BY ALL),
g AS (SELECT level, entity, fy, series, coalesce(dh, 0) - coalesce(net_raw, 0) AS gap, coalesce(hires, 0) AS hires
      FROM d FULL JOIN n USING (level, entity, series, fy) WHERE fy BETWEEN 2013 AND 2025),
e AS (SELECT level, entity, fy, sum(gap) AS gap_total, sum(abs(gap)) AS sum_abs_gap, sum(hires) AS hires FROM g GROUP BY ALL)

SELECT 'FY' || fy AS fy, level, sum((sum_abs_gap - abs(gap_total)) // 2) AS min_moves, sum(hires) AS hires
FROM e WHERE fy >= 2023 GROUP BY ALL ORDER BY 1, 2 DESC
```

Q8.1 (helpers: windows, flows, stock, stock_all)
```sql
WITH fl AS (SELECT w.grain, w.period, f.level, f.entity, f.series AS series,
                   sum(f.n) FILTER (WHERE flow = 'hires') AS hires, sum(f.n) FILTER (WHERE flow = 'departures') AS departures,
                   sum(f.n_transfer) FILTER (WHERE flow = 'hires') AS acc_transfer_in,
                   sum(f.n_transfer) FILTER (WHERE flow = 'departures') AS sep_transfer_out
            FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency', 'subelement') AND (w.grain <> 't12' OR w.period = '2026-08') GROUP BY ALL),
st AS (SELECT w.grain, w.period, s.level, s.entity, s.series AS series, sum(s.headcount) AS hc_sum,
              sum(s.headcount) FILTER (WHERE s.month = e.period_end) AS headcount, any_value(e.n_months) AS n_months
       FROM stock_all s JOIN windows w USING (month) JOIN window_end e USING (grain, period)
       WHERE s.level IN ('gov', 'department', 'agency', 'subelement') AND (w.grain <> 't12' OR w.period = '2026-08') GROUP BY ALL),
k AS (SELECT level, grain, period, entity, series, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(acc_transfer_in, 0) AS ti, coalesce(sep_transfer_out, 0) AS tout, coalesce(headcount, 0) AS hc,
             round(coalesce(hc_sum, 0) / coalesce(n_months, 12), 4) AS den
      FROM fl FULL JOIN st USING (grain, period, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || grain || '","' || period || '","' || series || '",' || hires
             || ',' || departures || ',' || ti || ',' || tout || ',' || hc || ',' || den::VARCHAR || ',' ||
             CASE WHEN den < 30 THEN 'true' ELSE 'false' END || '],')) + 200 AS bytes FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level
```

Q8.2 (helpers: windows, flows, stock, stock_all)
```sql
WITH fl AS (SELECT w.grain, w.period, f.level, f.entity, CASE WHEN regexp_full_match(f.series, '\d{4}') THEN left(f.series, 2) ELSE f.series END AS series,
                   sum(f.n) FILTER (WHERE flow = 'hires') AS hires, sum(f.n) FILTER (WHERE flow = 'departures') AS departures,
                   sum(f.n_transfer) FILTER (WHERE flow = 'hires') AS acc_transfer_in,
                   sum(f.n_transfer) FILTER (WHERE flow = 'departures') AS sep_transfer_out
            FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency', 'subelement') AND (w.grain <> 't12' OR w.period = '2026-08') GROUP BY ALL),
st AS (SELECT w.grain, w.period, s.level, s.entity, CASE WHEN regexp_full_match(s.series, '\d{4}') THEN left(s.series, 2) ELSE s.series END AS series, sum(s.headcount) AS hc_sum,
              sum(s.headcount) FILTER (WHERE s.month = e.period_end) AS headcount, any_value(e.n_months) AS n_months
       FROM stock_all s JOIN windows w USING (month) JOIN window_end e USING (grain, period)
       WHERE s.level IN ('gov', 'department', 'agency', 'subelement') AND (w.grain <> 't12' OR w.period = '2026-08') GROUP BY ALL),
k AS (SELECT level, grain, period, entity, series, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(acc_transfer_in, 0) AS ti, coalesce(sep_transfer_out, 0) AS tout, coalesce(headcount, 0) AS hc,
             round(coalesce(hc_sum, 0) / coalesce(n_months, 12), 4) AS den
      FROM fl FULL JOIN st USING (grain, period, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || grain || '","' || period || '","' || series || '",' || hires
             || ',' || departures || ',' || ti || ',' || tout || ',' || hc || ',' || den::VARCHAR || ',' ||
             CASE WHEN den < 30 THEN 'true' ELSE 'false' END || '],')) + 200 AS bytes FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level
```

Q8.3 (helpers: flows, stock, stock_all)
```sql
WITH fl AS (SELECT month, level, entity, CASE WHEN regexp_full_match(series, '\d{4}') THEN left(series, 2) ELSE series END AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ('gov', 'department', 'agency', 'subelement') AND month >= DATE '2011-10-01' GROUP BY ALL),
st AS (SELECT month, level, entity, CASE WHEN regexp_full_match(series, '\d{4}') THEN left(series, 2) ELSE series END AS series, sum(headcount) AS headcount FROM stock_all
       WHERE level IN ('gov', 'department', 'agency', 'subelement') AND month >= DATE '2011-10-01' GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level
```

Q8.4 (helpers: flows, stock, stock_all)
```sql
WITH fl AS (SELECT month, level, entity, series AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ('gov', 'department', 'agency', 'subelement') AND month >= DATE '2011-10-01' GROUP BY ALL),
st AS (SELECT month, level, entity, series AS series, sum(headcount) AS headcount FROM stock_all
       WHERE level IN ('gov', 'department', 'agency', 'subelement') AND month >= DATE '2011-10-01' GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level
```

Q8.5 (helpers: flows, stock, stock_all)
```sql
WITH fl AS (SELECT month, level, entity, series AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ('gov', 'department', 'agency', 'subelement') AND month >= DATE '2020-10-01' GROUP BY ALL),
st AS (SELECT month, level, entity, series AS series, sum(headcount) AS headcount FROM stock_all
       WHERE level IN ('gov', 'department', 'agency', 'subelement') AND month >= DATE '2020-10-01' GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level
```

Q8.6 (helpers: windows, flows)
```sql
WITH c AS (SELECT w.grain || ' ' || w.period AS grain, f.flow, f.entity, f.series AS series, CASE WHEN regexp_full_match(f.series, '\d{4}') THEN left(f.series, 2) ELSE f.series END AS family, f.n
           FROM flows f JOIN windows w USING (month)
           WHERE f.level = 'subelement' AND (w.grain, w.period) IN (('fy', 'FY2025'), ('t12', '2026-08'))),
s AS (SELECT 'series' AS key, grain, flow, entity, series AS k, sum(n) AS n FROM c GROUP BY ALL
      UNION ALL SELECT 'family', grain, flow, entity, family, sum(n) FROM c GROUP BY ALL)
SELECT key, flow, grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  count(*) FILTER (WHERE n < 30) AS lt30, round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM s GROUP BY ALL ORDER BY key DESC, flow, grain
```

Q8.7 (helpers: flows)
```sql
WITH h AS (SELECT agency_subelement_code AS entity, sum(headcount) AS hc FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1),
codes AS (SELECT agency_subelement_code AS entity FROM emp UNION SELECT entity FROM flows WHERE level = 'subelement')
SELECT CASE WHEN hc IS NULL THEN 0 WHEN hc < 30 THEN 1 WHEN hc < 500 THEN 2 WHEN hc < 5000 THEN 3 ELSE 4 END AS band,
       count(*) AS subelements, coalesce(sum(hc), 0) AS employees
FROM codes LEFT JOIN h USING (entity) GROUP BY ROLLUP (band) ORDER BY band NULLS LAST
```
