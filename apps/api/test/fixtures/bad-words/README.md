# Outside cases for the bad-words check

`ldnoobw-en.txt` is the English file of "List of Dirty, Naughty, Obscene, and Otherwise
Bad Words" (github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words,
CC BY 4.0), fetched 2026-10-05. It is not the list the app uses: it is here so the app's
list is tested against words it was not built from.

`let-through.txt` is every entry of it that a member's post is NOT refused for, decided
by hand on 2026-10-05:

- words a gym uses every day (snatch, butt, hardcore, domination, humping, suck);
- words that are also ordinary English (escort, nude, sexual, nipple, grope, topless);
- names of websites, films and acts no post would hold by accident.

A post of that kind is answered by Report, not by the check. The test fails when an entry
of the outside list is neither refused nor on this list, and when an entry on this list
starts being refused, so both files change only on purpose.
