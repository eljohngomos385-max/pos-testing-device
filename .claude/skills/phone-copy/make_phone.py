"""Copy an app folder into a new sandbox folder and wrap it in the iPhone frame (phone.html).
usage: py make_phone.py <source folder> <new folder>"""
import pathlib, shutil, sys

src, dst = map(pathlib.Path, sys.argv[1:3])
if dst.exists():
    sys.exit(f'{dst} already exists - pick a new name, nothing was copied')

def skip(folder, names):   # screenshots are lab notes, not the app
    d = pathlib.Path(folder)
    return [n for n in names if n.endswith('.png') or (d.name == 'img' and (d / n).is_dir())]

shutil.copytree(src, dst, ignore=skip)
shutil.copy(pathlib.Path(__file__).with_name('phone.html'), dst / 'phone.html')
# a file that reaches outside the copy would still read (or write) the original
leaks = [str(f.relative_to(dst)) for f in dst.rglob('*') if f.suffix in ('.html', '.js', '.css') and '../' in f.read_text('utf-8', 'ignore')]
print(f'made {dst}/phone.html' + (f'\nreaches outside the copy: {", ".join(leaks)}' if leaks else ''))
