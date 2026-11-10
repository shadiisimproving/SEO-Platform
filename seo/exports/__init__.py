"""Exports: every screen's data as a PDF report, an Excel workbook or a CSV file.

One definition per screen (seo/exports/views_*.py) builds a Report from the same service functions the screen's
own API uses. The three writers (pdf_out, xlsx_out, csv_out) turn any Report into a file, so a new screen is a few
lines in a views file and gets all three formats.
"""
