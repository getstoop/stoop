package instance

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

// randomInstanceName picks an adjective-noun pair from the porch/stoop
// vocabulary, e.g. "Rusty Awning". Seed calls this once per instance, at
// first boot, so a fleet of otherwise-identical installs — containers from
// the same image, VMs cloned from the same snapshot — doesn't introduce
// itself to a client as "Stoop" over and over. crypto/rand rather than
// math/rand: instances in the same fleet can boot in the same instant, and
// a time-seeded generator would hand them the same name.
func randomInstanceName() (string, error) {
	adj, err := pickWord(instanceAdjectives)
	if err != nil {
		return "", err
	}
	noun, err := pickWord(instanceNouns)
	if err != nil {
		return "", err
	}
	return adj + " " + noun, nil
}

func pickWord(words []string) (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(words))))
	if err != nil {
		return "", fmt.Errorf("pick random word: %w", err)
	}
	return words[n.Int64()], nil
}

// 60 adjectives x 60 nouns = 3600 pairs. By the birthday bound, even a
// user running 40 instances has under a 20% chance any two share a name,
// and under 5 instances it's under 1% — comfortably enough for a fleet
// one homelabber would ever actually run. TestInstanceNameWordlists
// checks both lists stay duplicate-free as they grow.
var instanceAdjectives = []string{
	"Rusty", "Quiet", "Sunny", "Narrow", "Creaky", "Shady", "Corner",
	"Crooked", "Brick", "Chalk", "Foggy", "Windy", "Cracked", "Gravel",
	"Cozy", "Faded", "Tidy", "Wobbly", "Leafy", "Weathered", "Dusty",
	"Damp", "Drafty", "Warm", "Chilly", "Snug", "Humble", "Modest",
	"Sagging", "Sturdy", "Peeling", "Painted", "Overgrown", "Potted",
	"Screened", "Covered", "Slanted", "Steep", "Cluttered", "Swept",
	"Splintered", "Patched", "Hidden", "Sheltered", "Breezy", "Frosty",
	"Muddy", "Sandy", "Mossy", "Downtown", "Uptown", "Quaint", "Battered",
	"Sleepy", "Bustling", "Friendly", "Familiar", "Weekday", "Weekend",
	"Late-night",
}

var instanceNouns = []string{
	"Awning", "Alley", "Stoop", "Porch", "Block", "Courtyard", "Doorway",
	"Streetlamp", "Landing", "Terrace", "Balcony", "Fire Escape",
	"Hydrant", "Mailbox", "Backyard", "Rooftop", "Walk-up", "Bodega",
	"Sidewalk", "Breezeway", "Stairwell", "Foyer", "Hallway", "Lobby",
	"Garden", "Patio", "Deck", "Driveway", "Garage", "Shed", "Fence",
	"Gate", "Gatepost", "Doorstep", "Threshold", "Windowsill", "Curb",
	"Crosswalk", "Intersection", "Cul-de-sac", "Boulevard", "Avenue",
	"Lane", "Skylight", "Row House", "Brownstone", "Townhouse",
	"Duplex", "Attic", "Basement", "Cellar", "Pantry", "Kitchen",
	"Parlor", "Vestibule", "Clothesline", "Birdbath", "Flowerbox",
	"Trellis", "Mailroom",
}
