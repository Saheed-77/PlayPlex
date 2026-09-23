package local.playplex.service;

/** Volunteers see a first name and a ticket number, never contact details (docs/01 §8). */
public final class Names {

    private Names() { }

    public static String firstName(String fullName) {
        if (fullName == null) return "";
        String trimmed = fullName.trim();
        int space = trimmed.indexOf(' ');
        return space < 0 ? trimmed : trimmed.substring(0, space);
    }
}
