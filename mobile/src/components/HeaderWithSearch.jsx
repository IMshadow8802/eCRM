import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/MaterialIcons";
import { theme } from "../constants/theme";
import SearchBar from "./SearchBar";
import StatsCards from "./StatsCards";

const HeaderWithSearch = ({
  title,
  navigation,
  searchText,
  setSearchText,
  searchPlaceholder = "Search...",
  statsData,
  // Filter props
  showFilters = false,
  filterConfig = null,
  // Big card props
  showBigCard = false,
  bigCardContent = null,
}) => {
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isFiltersVisible, setIsFiltersVisible] = useState(true); // Default open
  const searchAnimationValue = useState(new Animated.Value(0))[0];

  const toggleSearch = () => {
    const toValue = isSearchVisible ? 0 : 1;
    setIsSearchVisible(!isSearchVisible);

    Animated.timing(searchAnimationValue, {
      toValue,
      duration: 300,
      useNativeDriver: false,
    }).start();

    // Clear search text when hiding
    if (isSearchVisible) {
      setSearchText("");
    }
  };

  const toggleFilters = () => {
    setIsFiltersVisible(!isFiltersVisible);
  };

  return (
    <SafeAreaView style={styles.header} edges={["top"]}>
      {/* Gradient Splashes scattered around */}
      <LinearGradient
        colors={["rgba(173, 216, 230, 0.25)", "transparent"]}
        style={styles.gradientSplash1}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <LinearGradient
        colors={["rgba(144, 238, 144, 0.2)", "transparent"]}
        style={styles.gradientSplash2}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <LinearGradient
        colors={["rgba(255, 192, 203, 0.18)", "transparent"]}
        style={styles.gradientSplash3}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
      />
      <LinearGradient
        colors={["rgba(221, 160, 221, 0.22)", "transparent"]}
        style={styles.gradientSplash4}
        start={{ x: 1, y: 1 }}
        end={{ x: 0, y: 0 }}
      />
      <LinearGradient
        colors={["rgba(255, 255, 150, 0.15)", "transparent"]}
        style={styles.gradientSplash5}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <LinearGradient
        colors={["rgba(176, 224, 230, 0.12)", "transparent"]}
        style={styles.gradientSplash6}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
      />

      {/* Small colored dots scattered around */}
      <View style={[styles.dot, styles.dot1]} />
      <View style={[styles.dot, styles.dot2]} />
      <View style={[styles.dot, styles.dot3]} />
      <View style={[styles.dot, styles.dot4]} />
      <View style={[styles.dot, styles.dot5]} />
      <View style={[styles.dot, styles.dot6]} />
      <View style={[styles.dot, styles.dot7]} />
      <View style={[styles.dot, styles.dot8]} />

      <View style={styles.headerTop}>
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => navigation?.openDrawer()}
        >
          <View style={styles.menuIcon}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={toggleSearch}>
            <Icon name="search" size={22} color={theme.colors.gray[800]} />
          </TouchableOpacity>
          {showFilters && (
            <TouchableOpacity style={styles.iconBtn} onPress={toggleFilters}>
              <Icon
                name="filter-list"
                size={22}
                color={
                  isFiltersVisible
                    ? theme.colors.primary.brand
                    : theme.colors.gray[800]
                }
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search Bar - Animated */}
      {isSearchVisible && (
        <Animated.View
          style={[
            styles.searchContainer,
            {
              height: searchAnimationValue.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 60],
              }),
              opacity: searchAnimationValue,
              zIndex: 1,
              position: "relative",
            },
          ]}
        >
          <SearchBar
            value={searchText}
            onChangeText={setSearchText}
            placeholder={searchPlaceholder}
          />
        </Animated.View>
      )}

      {/* Big Card Section */}
      {showBigCard && bigCardContent && (
        <View style={styles.bigCardContainer}>{bigCardContent}</View>
      )}

      {/* Stats Cards */}
      {statsData && (
        <View style={styles.statsContainer}>
          <StatsCards {...statsData} />
        </View>
      )}

      {/* Filters Section - Toggleable when enabled */}
      {showFilters && filterConfig && isFiltersVisible && (
        <View style={styles.filtersContainer}>
          <View style={styles.filtersContent}>
            {filterConfig.renderFilters && filterConfig.renderFilters()}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: "#FFFFFF", // Pure white background
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 15,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    gap: 8,
    overflow: "hidden", // Important for gradients to be clipped
  },
  // Gradient splash positioned like scattered dots
  gradientSplash1: {
    position: "absolute",
    top: -20,
    left: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    zIndex: 0,
  },
  gradientSplash2: {
    position: "absolute",
    top: -40,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    zIndex: 0,
  },
  gradientSplash3: {
    position: "absolute",
    bottom: -30,
    left: 50,
    width: 110,
    height: 110,
    borderRadius: 55,
    zIndex: 0,
  },
  gradientSplash4: {
    position: "absolute",
    bottom: -25,
    right: -35,
    width: 90,
    height: 90,
    borderRadius: 45,
    zIndex: 0,
  },
  gradientSplash5: {
    position: "absolute",
    top: 40,
    right: 80,
    width: 80,
    height: 80,
    borderRadius: 40,
    zIndex: 0,
  },
  gradientSplash6: {
    position: "absolute",
    bottom: 50,
    left: 150,
    width: 70,
    height: 70,
    borderRadius: 35,
    zIndex: 0,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 1,
    position: "relative",
  },
  menuBtn: {
    width: 36,
    height: 36,
    backgroundColor: theme.colors.gray[50],
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  menuIcon: {
    width: 16,
    height: 12,
    justifyContent: "space-between",
  },
  menuLine: {
    width: 16,
    height: 2,
    backgroundColor: theme.colors.gray[600],
    borderRadius: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  searchContainer: {
    overflow: "hidden",
    marginTop: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    backgroundColor: theme.colors.gray[50],
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  bigCardContainer: {
    marginTop: 15,
    marginBottom: 5,
    zIndex: 1,
    position: "relative",
  },
  statsContainer: {
    zIndex: 1,
    position: "relative",
  },
  // Small colored dots
  dot: {
    position: "absolute",
    borderRadius: 50,
    zIndex: 0,
  },
  dot1: {
    width: 8,
    height: 8,
    backgroundColor: "rgba(255, 182, 193, 0.6)",
    top: 25,
    left: 60,
  },
  dot2: {
    width: 6,
    height: 6,
    backgroundColor: "rgba(173, 216, 230, 0.7)",
    top: 45,
    left: 120,
  },
  dot3: {
    width: 10,
    height: 10,
    backgroundColor: "rgba(255, 255, 224, 0.8)",
    top: 30,
    right: 40,
  },
  dot4: {
    width: 7,
    height: 7,
    backgroundColor: "rgba(221, 160, 221, 0.6)",
    bottom: 80,
    left: 30,
  },
  dot5: {
    width: 9,
    height: 9,
    backgroundColor: "rgba(144, 238, 144, 0.5)",
    bottom: 95,
    right: 70,
  },
  dot6: {
    width: 5,
    height: 5,
    backgroundColor: "rgba(255, 218, 185, 0.7)",
    top: 60,
    left: 200,
  },
  dot7: {
    width: 8,
    height: 8,
    backgroundColor: "rgba(230, 230, 250, 0.6)",
    bottom: 60,
    right: 120,
  },
  dot8: {
    width: 6,
    height: 6,
    backgroundColor: "rgba(255, 240, 245, 0.8)",
    top: 70,
    left: 80,
  },
  // Filters Container
  filtersContainer: {
    marginTop: 0,
    marginBottom: 0,
  },
  filtersContent: {
    // Remove marginHorizontal to match SearchBar width (header already has paddingHorizontal: 20)
  },
});

export default HeaderWithSearch;
