import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  Alert,
  Switch,
  Image,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from '../firebaseConfig';

const { width } = Dimensions.get("window");

export default function ProfileLinkageScreen({ navigation }) {
  const auth = getAuth();
  const [linkedDrivers, setLinkedDrivers] = useState([]);
  const [view, setView] = useState("list"); // "list" | "add" | "permissions"
  const [email, setEmail] = useState("");
  const [relation, setRelation] = useState("");
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);

  const [shareLocation, setShareLocation] = useState(true);
  const [shareTripHistory, setShareTripHistory] = useState(false);
  const [emergencyAlert, setEmergencyAlert] = useState(true);

  // Helper functions for user data
  const getUserName = useCallback(() => {
    if (!userData) return 'Family Admin';
    return (
      userData.fullName ||
      userData.name ||
      userData.displayName ||
      `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
      userData.email?.split('@')[0] ||
      'Family Admin'
    );
  }, [userData]);

  const getProfileImage = useCallback(() => {
    if (!userData) return null;
    return (
      userData.profileImage ||
      userData.photoURL ||
      userData.avatar ||
      userData.imageUrl ||
      null
    );
  }, [userData]);

  // Helper functions for driver data
  const getDriverName = useCallback((driverData) => {
    if (!driverData) return "Driver";
    return (
      driverData.name ||
      driverData.fullName ||
      `${driverData.firstName || ""} ${driverData.lastName || ""}`.trim() ||
      driverData.email?.split("@")[0] ||
      "Driver"
    );
  }, []);

  const getDriverProfileImage = useCallback((driverData) => {
    if (!driverData) return null;
    return (
      driverData.profileImg ||
      driverData.profileImage ||
      driverData.photoURL ||
      driverData.avatar ||
      driverData.imageUrl ||
      null
    );
  }, []);

  // Function to check if user is a driver
  const isDriverUser = (userData) => {
    if (!userData) return false;
    
    // Check multiple possible ways to identify a driver
    const isDriver =
      userData.driverProfile === true ||
      userData.isDriver === true ||
      userData.driver === true ||
      userData.role === "Driver" ||  // Capital D
      userData.role === "driver" ||  // lowercase d
      userData.userType === "Driver" ||
      userData.userType === "driver" ||
      userData.accountType === "Driver" ||
      userData.accountType === "driver";
    
    return isDriver;
  };

  // Fetch user data and linked drivers
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserData(null);
        setLinkedDrivers([]);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData(data);
          setLinkedDrivers(data.linkedDrivers || []);
        }
      } catch (e) {
        console.error('Error fetching user data:', e);
        Alert.alert("Error", "Failed to load user data");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const deleteLinkage = async (driver) => {
    if (!auth.currentUser?.uid) return;

    try {
      const familyUID = auth.currentUser.uid;
      
      // Remove from Family doc
      const familyRef = doc(db, "users", familyUID);
      const familySnap = await getDoc(familyRef);
      if (familySnap.exists()) {
        const currentDrivers = familySnap.data().linkedDrivers || [];
        const updatedDrivers = currentDrivers.filter(
          (d) => d.driverId !== driver.driverId
        );
        await updateDoc(familyRef, { linkedDrivers: updatedDrivers });
      }

      // Remove from Driver doc
      const driverRef = doc(db, "users", driver.driverId);
      const driverSnap = await getDoc(driverRef);
      if (driverSnap.exists()) {
        const currentFamilies = driverSnap.data().linkedFamilies || [];
        const updatedFamilies = currentFamilies.filter(
          (f) => f.familyId !== familyUID
        );
        await updateDoc(driverRef, { linkedFamilies: updatedFamilies });
      }

      // Update local state
      setLinkedDrivers(prev => prev.filter(d => d.driverId !== driver.driverId));
      Alert.alert("Success", "Driver link removed successfully");
    } catch (e) {
      console.error("Error deleting linkage:", e);
      Alert.alert("Error", "Failed to remove driver link");
    }
  };

  const confirmDeleteLinkage = (driver) => {
    Alert.alert(
      "Remove Driver",
      `Are you sure you want to remove ${getDriverName(driver)} from your linked drivers?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => deleteLinkage(driver) },
      ]
    );
  };

  const addNewProfile = async () => {
    const trimmedEmail = email.toLowerCase().trim();
    
    if (!trimmedEmail || !relation) {
      Alert.alert("Missing Information", "Please enter email and select relation");
      return;
    }

    const familyUID = auth.currentUser?.uid;
    if (!familyUID) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    setSearching(true);
    try {
      // Search for driver by email
      const q = query(
        collection(db, "users"),
        where("email", "==", trimmedEmail)
      );
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        Alert.alert("User Not Found", "No user found with this email address");
        return;
      }

      const driverDoc = querySnap.docs[0];
      const driverData = driverDoc.data();
      const driverId = driverDoc.id;
      
      // Check if already linked
      const existingLink = linkedDrivers.find(d => d.driverId === driverId);
      if (existingLink) {
        Alert.alert("Already Linked", "This driver is already linked to your account");
        return;
      }

      // Check if trying to link to self
      if (driverId === familyUID) {
        Alert.alert("Invalid Selection", "You cannot link to yourself");
        return;
      }

      // Check if user has driver role - using the corrected function
      if (!isDriverUser(driverData)) {
        Alert.alert("Invalid User", "This user is not registered as a driver");
        return;
      }

      const newDriverLink = {
        driverId,
        email: trimmedEmail,
        name: getDriverName(driverData),
        relation,
        profileImg: getDriverProfileImage(driverData) || "",
        permissions: {
          shareLocation: true,
          shareTripHistory: false,
          emergencyAlert: true
        },
        linkedAt: new Date().toISOString()
      };

      const newFamilyLink = {
        familyId: familyUID,
        email: auth.currentUser.email,
        name: getUserName(),
        relation,
        profileImage: getProfileImage() || "",
        permissions: {
          shareLocation: true,
          shareTripHistory: false,
          emergencyAlert: true
        },
        linkedAt: new Date().toISOString()
      };

      // Update both documents
      const familyRef = doc(db, "users", familyUID);
      const driverRef = doc(db, "users", driverId);
      
      await updateDoc(familyRef, {
        linkedDrivers: arrayUnion(newDriverLink)
      });

      await updateDoc(driverRef, {
        linkedFamilies: arrayUnion(newFamilyLink)
      });

      // Update local state
      setLinkedDrivers(prev => [...prev, newDriverLink]);
      setEmail("");
      setRelation("");
      setView("list");
      
      Alert.alert("Success", "Driver linked successfully!");
    } catch (e) {
      console.error("Error adding linkage:", e);
      Alert.alert("Error", "Failed to link driver. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const openPermissions = async (driver) => {
    setSelectedDriver(driver);
    try {
      const driverRef = doc(db, "users", driver.driverId);
      const driverDoc = await getDoc(driverRef);
      if (driverDoc.exists()) {
        const linkedFamilies = driverDoc.data().linkedFamilies || [];
        const familyLink = linkedFamilies.find((f) => f.familyId === auth.currentUser?.uid) || {};
        
        const permissions = familyLink.permissions || {};
        setShareLocation(permissions.shareLocation ?? true);
        setShareTripHistory(permissions.shareTripHistory ?? false);
        setEmergencyAlert(permissions.emergencyAlert ?? true);
      }
    } catch (e) {
      console.error("Error fetching permissions:", e);
      Alert.alert("Error", "Failed to load permissions");
    }
    setView("permissions");
  };

  const savePermissions = async () => {
    if (!selectedDriver || !auth.currentUser?.uid) return;
    
    setSaving(true);
    try {
      const familyUID = auth.currentUser.uid;
      const permissions = {
        shareLocation,
        shareTripHistory, 
        emergencyAlert,
        updatedAt: new Date().toISOString()
      };

      // Update driver's linkedFamilies
      const driverRef = doc(db, "users", selectedDriver.driverId);
      const driverDoc = await getDoc(driverRef);
      
      if (driverDoc.exists()) {
        const linkedFamilies = driverDoc.data().linkedFamilies || [];
        const updatedFamilies = linkedFamilies.map((f) => {
          if (f.familyId === familyUID) {
            return { 
              ...f, 
              ...permissions,
              permissions
            };
          }
          return f;
        });
        
        await updateDoc(driverRef, { linkedFamilies: updatedFamilies });
      }

      // Update family's linkedDrivers
      const familyRef = doc(db, "users", familyUID);
      const familyDoc = await getDoc(familyRef);
      
      if (familyDoc.exists()) {
        const updatedDrivers = linkedDrivers.map((d) => {
          if (d.driverId === selectedDriver.driverId) {
            return { 
              ...d, 
              ...permissions,
              permissions
            };
          }
          return d;
        });
        
        await updateDoc(familyRef, { linkedDrivers: updatedDrivers });
        setLinkedDrivers(updatedDrivers);
      }
      
      Alert.alert("Success", "Permissions updated successfully");
      setView("list");
    } catch (e) {
      console.error("Error saving permissions:", e);
      Alert.alert("Error", "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  const renderDriverCard = (driver, index) => (
    <TouchableOpacity
      key={driver.driverId || index}
      style={styles.driverCard}
      onPress={() => openPermissions(driver)}
      activeOpacity={0.8}
    >
      <View style={styles.driverImageContainer}>
        {getDriverProfileImage(driver) ? (
          <Image
            source={{ uri: getDriverProfileImage(driver) }}
            style={styles.driverProfileImage}
          />
        ) : (
          <View style={styles.driverProfileImagePlaceholder}>
            <Ionicons name="person" size={24} color="#d63384" />
          </View>
        )}
      </View>
      <View style={styles.driverInfo}>
        <View style={styles.driverNameRow}>
          <Text style={styles.driverName} numberOfLines={1}>
            {getDriverName(driver)}
          </Text>
          <View style={styles.relationBadge}>
            <Text style={styles.relationBadgeText}>{driver.relation || "Other"}</Text>
          </View>
        </View>
        <Text style={styles.driverEmail} numberOfLines={1}>
          {driver.email}
        </Text>
        
        {/* Permission Status Icons */}
        <View style={styles.permissionIcons}>
          <View style={styles.permissionIcon}>
            <Ionicons 
              name={driver.permissions?.shareLocation ? "location" : "location-outline"} 
              size={16} 
              color={driver.permissions?.shareLocation ? "#28a745" : "#dc3545"} 
            />
            <Text style={styles.permissionIconText}>Location</Text>
          </View>
          <View style={styles.permissionIcon}>
            <Ionicons 
              name={driver.permissions?.shareTripHistory ? "time" : "time-outline"} 
              size={16} 
              color={driver.permissions?.shareTripHistory ? "#28a745" : "#dc3545"} 
            />
            <Text style={styles.permissionIconText}>Trips</Text>
          </View>
          <View style={styles.permissionIcon}>
            <Ionicons 
              name={driver.permissions?.emergencyAlert ? "alert-circle" : "alert-circle-outline"} 
              size={16} 
              color={driver.permissions?.emergencyAlert ? "#28a745" : "#dc3545"} 
            />
            <Text style={styles.permissionIconText}>Alerts</Text>
          </View>
        </View>
      </View>
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            openPermissions(driver);
          }}
          style={styles.editButton}
        >
          <Ionicons name="settings" size={20} color="#d63384" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            confirmDeleteLinkage(driver);
          }}
          style={styles.deleteButton}
        >
          <Ionicons name="trash-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const name = getUserName();
  const profileImage = getProfileImage();
  const relationOptions = [
    "Father", "Mother", "Brother", "Sister", 
    "Son", "Daughter", "Spouse", "Friend", "Other"
  ];

  return (
    <View style={styles.mainContainer}>
      {/* HEADER */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>
              {view === "list" ? "Profile Linkage" : 
               view === "add" ? "Add Driver" : "Permissions"}
            </Text>
          </View>

          {/* Profile Section */}
          <View style={styles.profileWrapper}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                {profileImage ? (
                  <Image source={{ uri: profileImage }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="person" size={20} color="#d63384" />
                  </View>
                )}
                <Text style={styles.profileName} numberOfLines={1}>
                  {name}
                </Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.curve} />
      </View>

      {/* CONTENT AREA */}
      <View style={styles.content}>
        {view === "list" ? (
          <>
            <View style={styles.statsBar}>
              <View style={styles.statItem}>
                <Ionicons name="people" size={24} color="#d63384" />
                <View style={styles.statText}>
                  <Text style={styles.statNumber}>{linkedDrivers.length}</Text>
                  <Text style={styles.statLabel}>Linked Drivers</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setView("add")}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.addButtonText}>Add Driver</Text>
              </TouchableOpacity>
            </View>

            {linkedDrivers.length > 0 ? (
              <ScrollView 
                style={styles.listScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContainer}
              >
                {linkedDrivers.map(renderDriverCard)}
              </ScrollView>
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconContainer}>
                  <Ionicons name="people-outline" size={80} color="#e9ecef" />
                </View>
                <Text style={styles.emptyText}>No drivers linked yet</Text>
                <Text style={styles.emptySubText}>
                  Link drivers to monitor their trips and location
                </Text>
                <TouchableOpacity
                  style={styles.emptyStateButton}
                  onPress={() => setView("add")}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={20} color="#fff" style={styles.buttonIcon} />
                  <Text style={styles.emptyStateButtonText}>Add Your First Driver</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : view === "add" ? (
          <ScrollView 
            style={styles.formScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.formContainer}
          >
            <View style={styles.formHeader}>
              <Ionicons name="person-add" size={28} color="#d63384" />
              <Text style={styles.formTitle}>Link New Driver</Text>
              <Text style={styles.formSubtitle}>
                Enter the email of a registered driver to link their profile
              </Text>
            </View>

            <View style={styles.inputCard}>
              <Text style={styles.inputLabel}>Driver Email</Text>
              <TextInput
                placeholder="driver@example.com"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputCard}>
              <Text style={styles.inputLabel}>Relation to Driver</Text>
              <View style={styles.relationButtons}>
                {relationOptions.map((rel) => (
                  <TouchableOpacity
                    key={rel}
                    style={[
                      styles.relationButton,
                      relation === rel && styles.relationButtonSelected
                    ]}
                    onPress={() => setRelation(rel)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.relationButtonText,
                      relation === rel && styles.relationButtonTextSelected
                    ]}>
                      {rel}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.noteCard}>
              <Ionicons name="information-circle" size={20} color="#17a2b8" />
              <Text style={styles.noteText}>
                The driver will receive a notification and must accept the link request
              </Text>
            </View>

            <TouchableOpacity 
              style={[styles.submitButton, (!email || !relation) && styles.disabledButton]} 
              onPress={addNewProfile}
              disabled={!email || !relation || searching}
              activeOpacity={0.8}
            >
              {searching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="link" size={20} color="#fff" style={styles.buttonIcon} />
                  <Text style={styles.submitButtonText}>Link Driver Profile</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => setView("list")} 
              style={styles.cancelButton}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={18} color="#6c757d" />
              <Text style={styles.cancelButtonText}>Back to List</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          // Permissions View
          selectedDriver && (
            <ScrollView 
              style={styles.formScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formContainer}
            >
              <View style={styles.formHeader}>
                <Ionicons name="settings" size={28} color="#d63384" />
                <Text style={styles.formTitle}>
                  Permissions for {getDriverName(selectedDriver)}
                </Text>
                <Text style={styles.formSubtitle}>
                  Control what information this driver can access
                </Text>
              </View>

              <View style={styles.driverInfoCard}>
                <View style={styles.driverInfoHeader}>
                  {getDriverProfileImage(selectedDriver) ? (
                    <Image
                      source={{ uri: getDriverProfileImage(selectedDriver) }}
                      style={styles.driverProfileImageLarge}
                    />
                  ) : (
                    <View style={styles.driverProfileImagePlaceholderLarge}>
                      <Ionicons name="person" size={32} color="#d63384" />
                    </View>
                  )}
                  <View style={styles.driverInfoText}>
                    <Text style={styles.driverNameLarge}>{getDriverName(selectedDriver)}</Text>
                    <Text style={styles.driverEmailLarge}>{selectedDriver.email}</Text>
                    <Text style={styles.driverRelation}>Relation: {selectedDriver.relation || "Not specified"}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.permissionsCard}>
                {[
                  {
                    icon: "location",
                    title: "Share Location",
                    subtitle: "Allow this driver to see your real-time location",
                    value: shareLocation,
                    onChange: setShareLocation
                  },
                  {
                    icon: "time",
                    title: "Share Trip History",
                    subtitle: "Allow access to your past trip history",
                    value: shareTripHistory,
                    onChange: setShareTripHistory
                  },
                  {
                    icon: "alert-circle",
                    title: "Emergency Alerts",
                    subtitle: "Receive emergency notifications from this driver",
                    value: emergencyAlert,
                    onChange: setEmergencyAlert
                  }
                ].map((permission, index) => (
                  <View key={index} style={styles.permissionItem}>
                    <View style={styles.permissionIconContainer}>
                      <Ionicons name={permission.icon} size={24} color="#d63384" />
                    </View>
                    <View style={styles.permissionContent}>
                      <Text style={styles.permissionTitle}>{permission.title}</Text>
                      <Text style={styles.permissionSubtitle}>{permission.subtitle}</Text>
                    </View>
                    <Switch
                      value={permission.value}
                      onValueChange={permission.onChange}
                      trackColor={{ false: "#e0e0e0", true: "#d63384" }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </View>

              <TouchableOpacity 
                style={[styles.submitButton, saving && styles.disabledButton]} 
                onPress={savePermissions}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save" size={20} color="#fff" style={styles.buttonIcon} />
                    <Text style={styles.submitButtonText}>Save Permissions</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => setView("list")} 
                style={styles.cancelButton}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={18} color="#6c757d" />
                <Text style={styles.cancelButtonText}>Back to List</Text>
              </TouchableOpacity>
            </ScrollView>
          )
        )}
      </View>

      {/* FOOTER */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity 
            onPress={() => navigation.navigate("FamilyDashboard")}
            style={styles.footerButton}
          >
            <Ionicons name="home" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => navigation.navigate("DriverTracking")}
            style={styles.footerButton}
          >
            <Ionicons name="map" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => navigation.navigate("FamilySettings")}
            style={styles.footerButton}
          >
            <Ionicons name="settings" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { 
    flex: 1, 
    backgroundColor: "#fff" 
  },
  headerWrapper: { 
    position: "relative", 
    backgroundColor: "#d63384" 
  },
  headerContent: {
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  curve: {
    width: width,
    height: 30,
    backgroundColor: "#fff",
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
  },
  headerTitle: { 
    fontSize: 24, 
    fontWeight: "bold", 
    color: "#fff" 
  },
  subTitle: { 
    fontSize: 14, 
    color: "#fff", 
    marginTop: 2,
    opacity: 0.9,
  },
  profileWrapper: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "50%",
  },
  profileName: {
    color: "#fff",
    marginLeft: 10,
    fontSize: 14,
    fontWeight: "600",
    maxWidth: 120,
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#fff",
  },
  profileImagePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  statText: {
    marginLeft: 10,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#d63384",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 25,
    elevation: 2,
    shadowColor: "#d63384",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
    marginLeft: 6,
  },
  listScroll: {
    flex: 1,
  },
  listContainer: { 
    padding: 16,
    paddingBottom: 100,
  },
  formScroll: {
    flex: 1,
  },
  formContainer: { 
    padding: 16,
    paddingBottom: 100,
  },
  formHeader: {
    alignItems: "center",
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginTop: 12,
    marginBottom: 6,
    textAlign: "center",
  },
  formSubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  inputCard: {
    backgroundColor: "#fff",
    padding: 18,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e9ecef",
    fontSize: 16,
    color: "#333",
  },
  relationButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 8,
  },
  relationButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  relationButtonSelected: {
    backgroundColor: "#d63384",
    borderColor: "#d63384",
  },
  relationButtonText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  relationButtonTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  noteCard: {
    flexDirection: "row",
    backgroundColor: "#e7f5ff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: "center",
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: "#17a2b8",
    marginLeft: 10,
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d63384",
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 4,
    shadowColor: "#d63384",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  disabledButton: {
    backgroundColor: "#ccc",
    shadowColor: "#ccc",
  },
  submitButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  buttonIcon: {
    marginRight: 8,
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  cancelButtonText: {
    color: "#6c757d",
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 6,
  },
  driverCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderLeftWidth: 4,
    borderLeftColor: "#d63384",
  },
  driverImageContainer: {
    marginRight: 12,
  },
  driverProfileImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "#f0f0f0",
  },
  driverProfileImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#f8d7da",
    justifyContent: "center",
    alignItems: "center",
  },
  driverInfo: {
    flex: 1,
  },
  driverNameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  driverName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  relationBadge: {
    backgroundColor: "#e9ecef",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  relationBadgeText: {
    fontSize: 11,
    color: "#666",
    fontWeight: "500",
  },
  driverEmail: {
    fontSize: 13,
    color: "#666",
    marginBottom: 8,
  },
  permissionIcons: {
    flexDirection: "row",
    gap: 12,
  },
  permissionIcon: {
    flexDirection: "row",
    alignItems: "center",
  },
  permissionIconText: {
    fontSize: 11,
    color: "#666",
    marginLeft: 4,
  },
  actionsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  editButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f8d7da",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#dc3545",
    justifyContent: "center",
    alignItems: "center",
  },
  driverInfoCard: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  driverInfoHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  driverProfileImageLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 16,
    borderWidth: 3,
    borderColor: "#d63384",
  },
  driverProfileImagePlaceholderLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#f8d7da",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
    borderWidth: 3,
    borderColor: "#d63384",
  },
  driverInfoText: {
    flex: 1,
  },
  driverNameLarge: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 2,
  },
  driverEmailLarge: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  driverRelation: {
    fontSize: 13,
    color: "#888",
    fontStyle: "italic",
  },
  permissionsCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 20,
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  permissionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f8d7da",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  permissionContent: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  permissionSubtitle: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#f8f9fa",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  emptyText: {
    fontSize: 20,
    color: "#333",
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubText: {
    fontSize: 15,
    color: "#6c757d",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  emptyStateButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#d63384",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    elevation: 4,
    shadowColor: "#d63384",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  emptyStateButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  footerWrapper: { 
    position: "absolute", 
    bottom: 16, 
    width: "100%", 
    alignItems: "center" 
  },
  footerNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#d63384",
    width: width * 0.9,
    borderRadius: 35,
    paddingVertical: 14,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  footerButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
});